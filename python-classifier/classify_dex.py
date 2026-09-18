"""
End-to-end single-file malware-family classifier.

Pipeline (mirrors your bulk C++ / Python scripts, but for one .dex at a time,
entirely in memory -- no intermediate files written to disk):

  1. baksmali dump                 (your PowerShell one-liner, "dump" mode)
  2. assemblyToOP.cpp   equivalent -> extract 2-hex-char "opcode" per dump line
  3. oPToNGram.cpp      equivalent -> sliding window of 5 opcodes ("five-grams")
  4. NGramToFrequency.cpp equiv.   -> top 50,000 five-grams by frequency, THIS file
  5. FrequencyCSV.cpp   equivalent -> look those up against the 10,000-column
                                      "integrated" reference (integrate_file.txt)
  6. featureImportance.py equiv.   -> reduce to the trained model's 1000 columns
  7. Keras CNN (best_model.h5)     -> scale + predict, print predicted family
                                      + confidence. Class order: see
                                      CLASS_LABELS below -- it MUST match
                                      training order, since the .h5 file
                                      itself has no label names stored.

------------------------------------------------------------------------------
IMPORTANT ONE-TIME SETUP
------------------------------------------------------------------------------
The .h5 model itself carries no column order or fitted scaler -- both come
from your training feature CSV (e.g. importance_1000.csv: 1000 five-gram
columns + a trailing `label` column). Run this once:

    python classify_dex.py --fit-scaler "D:\\importance_1000.csv" \\
                            --scaler-out "D:\\scaler.joblib" \\
                            --fit-scaler-columns-out "D:\\top1000_columns.json"

(The old --extract-columns flag is still here for the previous model's
fiveGram_matrix_top1000.csv format, but isn't what you want for this one.)

After that, normal usage is just:

    python classify_dex.py --dex "D:\\some_sample.dex"
------------------------------------------------------------------------------
"""

import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from collections import Counter
from pathlib import Path

# Quiets TensorFlow's default startup noise (CPU optimization notices etc.)
# on stdout/stderr -- purely cosmetic, doesn't affect anything functional.
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np
import pandas as pd
import joblib
from sklearn.preprocessing import StandardScaler
from tensorflow.keras.models import load_model

# ------------------------------------------------------------------
# CONFIG -- read from environment variables in production (set by the
# Node service that invokes this script). Falls back to the original
# hardcoded Windows paths for local/manual testing only.
# ------------------------------------------------------------------
BAKSMALI_JAR = os.environ.get("BAKSMALI_JAR", r"D:\baksmali-2.5.2-2771eae0-fat.jar")
INTEGRATED_FIVEGRAMS_FILE = os.environ.get(
    "INTEGRATED_FIVEGRAMS_FILE", r"D:\integrate_file.txt"
)  # top 10,000 5-grams, built by integratedFrequencies.cpp
TOP1000_COLUMNS_FILE = os.environ.get(
    "TOP1000_COLUMNS_FILE", r"D:\top1000_columns.json"
)  # produced by --extract-columns (see module docstring above)
MODEL_BUNDLE_PATH = os.environ.get("MODEL_BUNDLE_PATH", r"D:\best_model.h5")
SCALER_PATH = os.environ.get("SCALER_PATH", r"D:\scaler.joblib")  # produced by --fit-scaler

TOP_N_PER_FILE = 50_000   # matches NGramToFrequency.cpp's topN
NUM_FEATURES = 1000       # confirmed from the model's InputLayer: batch_shape (None, 1000, 1)

# Fixed index -> class name mapping. The Keras .h5 model has no equivalent
# to the old joblib bundle's LabelEncoder -- Keras only knows the output
# layer is 5-wide, not what each index means. This order MUST match
# whatever order the labels were in during training.
#
# Corrected 2026 -- the originally-assumed order ("Benign", "SMS",
# "Banking", "Riskware", "Adware") was producing mismatched predictions
# in testing: what it called Riskware was actually Banking, Adware was
# actually Riskware, Banking was actually SMS, and SMS was actually
# Adware. This order reflects that correction.
CLASS_LABELS = ["Benign", "Adware", "SMS", "Banking", "Riskware"]

# --- TEMPORARY: hardcoded paths for quick manual testing ---------
# Only used if you run `python classify_dex.py` with no --dex flag at all.
# In production the Node service always passes --dex explicitly.
BAKSMALI_PATH = BAKSMALI_JAR
DEX_FILE_PATH = os.environ.get("DEX_FILE_PATH", "")
# -------------------------------------------------------------------


# ------------------------------------------------------------------
# 0. APK support -- extract classes.dex before handing off to baksmali
# ------------------------------------------------------------------
def extract_dex_from_apk(apk_path: str) -> str:
    """
    An APK is just a zip archive. Extracts the primary classes.dex to a
    temp file and returns its path -- caller is responsible for deleting
    it afterward.

    NOTE: this only looks at classes.dex, the app's primary/main dex.
    Multidex apps (classes2.dex, classes3.dex, ...) are not combined --
    this is a deliberate simplification, not an oversight. Extend this if
    you need coverage across all dex entries in a multidex APK.
    """
    with zipfile.ZipFile(apk_path, "r") as zf:
        if "classes.dex" not in zf.namelist():
            raise ValueError(f"{apk_path} has no classes.dex entry (not a valid APK?)")
        data = zf.read("classes.dex")

    fd, tmp_path = tempfile.mkstemp(suffix=".dex")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return tmp_path


# ------------------------------------------------------------------
# 1. baksmali dump
# ------------------------------------------------------------------
def run_baksmali_dump(dex_path: str, baksmali_jar: str = BAKSMALI_JAR) -> str:
    """Equivalent of: java -jar baksmali.jar dump <dex> > out.txt
    Returns the dump text directly, no file written."""
    result = subprocess.run(
        ["java", "-jar", baksmali_jar, "dump", str(dex_path)],
        capture_output=True,
        text=True,
        errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"baksmali failed on {dex_path}:\n{result.stderr}")
    return result.stdout


# ------------------------------------------------------------------
# 2. dump text -> opcode stream   (assemblyToOP.cpp equivalent)
# ------------------------------------------------------------------
def extract_opcodes(dump_text: str) -> list[str]:
    """
    assemblyToOP.cpp keeps only lines where line[6] == ':' (the fixed-width
    "dump" offset column) and takes the two hex characters at positions 8-9
    -- i.e. the first byte value shown on that line -- as the "opcode".
    Replicated verbatim here, just operating on an in-memory string instead
    of a UTF-16 file on disk.
    """
    opcodes = []
    # strip a leading BOM if present, since we skip the UTF-16-with-BOM
    # round trip that Windows' `>` redirection was doing in your original flow
    if dump_text and dump_text[0] == "\ufeff":
        dump_text = dump_text[1:]

    for line in dump_text.splitlines():
        if line.endswith("\r"):
            line = line[:-1]
        if len(line) > 9 and line[6] == ":":
            opcodes.append(line[8:10])
    return opcodes


# ------------------------------------------------------------------
# 3. opcode stream -> five-grams   (oPToNGram.cpp equivalent)
# ------------------------------------------------------------------
def build_fivegrams(opcodes: list[str]) -> list[str]:
    """
    Sliding window of 5 consecutive opcodes, comma-joined, e.g. '5a,ff,00,55,6e'.
    Matches oPToNGram.cpp exactly: only complete 5-windows are emitted (no
    padded/partial windows at the tail).
    """
    fivegrams = []
    window: list[str] = []
    for op in opcodes:
        window.append(op)
        if len(window) > 5:
            window.pop(0)
        if len(window) == 5:
            fivegrams.append(",".join(window))
    return fivegrams


# ------------------------------------------------------------------
# 4. five-grams -> top 50,000 frequency map for THIS file
#    (NGramToFrequency.cpp equivalent)
# ------------------------------------------------------------------
def top_fivegram_frequencies(fivegrams: list[str], top_n: int = TOP_N_PER_FILE) -> dict[str, int]:
    counts = Counter(fivegrams)
    return dict(counts.most_common(top_n))


# ------------------------------------------------------------------
# 5. build the full row against the 10,000-column reference
#    (FrequencyCSV.cpp equivalent)
# ------------------------------------------------------------------
def load_integrated_columns(path: str = INTEGRATED_FIVEGRAMS_FILE) -> list[str]:
    """Parses integrate_file.txt lines of the form '<5gram>, <count>' and
    returns just the ordered list of 5gram column names (same parsing rule
    as FrequencyCSV.cpp: split on the LAST comma, since the 5gram itself
    contains commas)."""
    columns = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            last_comma = line.rfind(",")
            if last_comma == -1:
                continue
            columns.append(line[:last_comma])
    return columns


def build_full_row(freqs: dict[str, int], integrated_columns: list[str]) -> dict[str, int]:
    """One row: for every column in the 10,000-wide reference, this file's
    count (0 if this file never produced that five-gram in its own top 50k)."""
    return {col: freqs.get(col, 0) for col in integrated_columns}


# ------------------------------------------------------------------
# 6. reduce to the model's trained 1000 columns, in the trained order
#    (featureImportance.py's selection, applied at inference time)
# ------------------------------------------------------------------
def load_top1000_columns(path: str = TOP1000_COLUMNS_FILE) -> list[str]:
    with open(path, "r", encoding="utf-8") as f:
        cols = json.load(f)
    if not isinstance(cols, list):
        raise ValueError(f"{path} should contain a JSON list of column names")
    return cols


def reduce_to_top1000(full_row: dict[str, int], top1000_columns: list[str]) -> np.ndarray:
    """
    IMPORTANT: any column here that isn't in `full_row` (i.e. wasn't among
    this file's own top-50k five-grams, or isn't in the 10k integrated
    reference at all) is treated as 0 -- same as every other file that
    doesn't contain that five-gram.
    """
    return np.array([full_row.get(col, 0) for col in top1000_columns], dtype=np.float32)


def extract_columns_from_top1000_csv(csv_path: str, out_json_path: str) -> None:
    """One-time helper: pulls the ordered column list straight out of the
    header row of fiveGram_matrix_top1000.csv (the file featureImportance.py
    produced). Column order in that CSV IS the order CNN_for_Malware_Data.py
    trained on (df.columns[2:]), so this is exactly what the model expects."""
    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
    cols = header[2:]  # drop 'file', 'label'
    with open(out_json_path, "w", encoding="utf-8") as f:
        json.dump(cols, f)
    print(f"[INFO] Extracted {len(cols)} columns from {csv_path} -> {out_json_path}")


# ------------------------------------------------------------------
# 7. one-time setup: fit + save the StandardScaler, AND extract the
#    matching column order, from the same training CSV
# ------------------------------------------------------------------
def fit_and_save_scaler(training_csv_path: str, scaler_out_path: str, columns_out_path: str) -> None:
    """
    One-time setup for the new model. Reads a training feature CSV (e.g.
    importance_1000.csv: 1000 five-gram feature columns + a trailing
    `label` column, no `file` identifier column -- NOT the same layout as
    the old fiveGram_matrix_top1000.csv / --extract-columns) and:

      1. Fits + saves a StandardScaler on the feature columns.
      2. Saves those same columns' names, in the same order, to
         top1000_columns.json.

    Doing both from the SAME file in the SAME read guarantees the
    scaler's fitted feature order and reduce_to_top1000()'s column order
    can never drift apart from each other.

    IMPORTANT: this CSV's column headers use space-separated five-grams
    ("16 6e 22 70 6e"), but the rest of the pipeline -- build_fivegrams()
    and integrate_file.txt -- uses comma-separated ("16,6e,22,70,6e").
    Without converting, every lookup in reduce_to_top1000() would silently
    miss and the model would score an all-zero feature vector every time,
    with no error to show for it. This function does that conversion.
    """
    df = pd.read_csv(training_csv_path)
    df = df.fillna(0)

    feature_columns = [col.replace(" ", ",") for col in df.columns[:-1]]  # space -> comma
    X = df.iloc[:, :-1].values

    scaler = StandardScaler()
    scaler.fit(X)
    joblib.dump(scaler, scaler_out_path)
    print(f"[INFO] Fit StandardScaler on {X.shape[0]} rows, {X.shape[1]} features -> {scaler_out_path}")

    with open(columns_out_path, "w", encoding="utf-8") as f:
        json.dump(feature_columns, f)
    print(f"[INFO] Saved {len(feature_columns)} column names (comma-format) -> {columns_out_path}")


# ------------------------------------------------------------------
# 8. Keras model inference
# ------------------------------------------------------------------
def classify_feature_vector(
    feature_vector: np.ndarray,
    model_path: str = MODEL_BUNDLE_PATH,
    scaler_path: str = SCALER_PATH,
):
    """Loads the trained Keras model + its saved StandardScaler and scores
    ONE sample. Model expects (batch, 1000, 1) input and outputs a 5-way
    softmax -- see CLASS_LABELS above for the index -> name mapping."""
    if feature_vector.shape[0] != NUM_FEATURES:
        raise ValueError(
            f"Feature vector has {feature_vector.shape[0]} values but the "
            f"model expects {NUM_FEATURES}. Your top1000 columns file "
            f"likely doesn't match what the model was trained on."
        )

    scaler = joblib.load(scaler_path)
    model = load_model(model_path)

    x_row = feature_vector.reshape(1, -1)                # (1, 1000)
    x_scaled = scaler.transform(x_row)                    # (1, 1000)
    x_input = x_scaled.reshape(-1, NUM_FEATURES, 1)        # (1, 1000, 1) -- matches training

    probs = model.predict(x_input, verbose=0)[0]           # softmax output, already probabilities

    if len(probs) != len(CLASS_LABELS):
        raise ValueError(
            f"Model outputs {len(probs)} classes but CLASS_LABELS has "
            f"{len(CLASS_LABELS)} entries -- update CLASS_LABELS to match."
        )

    pred_idx = int(np.argmax(probs))
    pred_label = CLASS_LABELS[pred_idx]
    confidence = float(probs[pred_idx])
    per_class = {cls: float(p) for cls, p in zip(CLASS_LABELS, probs)}

    return pred_label, confidence, per_class


# ------------------------------------------------------------------
# Orchestration
# ------------------------------------------------------------------
def classify_dex_file(
    dex_path: str,
    baksmali_jar: str = BAKSMALI_JAR,
    integrated_columns_path: str = INTEGRATED_FIVEGRAMS_FILE,
    top1000_columns_path: str = TOP1000_COLUMNS_FILE,
    model_path: str = MODEL_BUNDLE_PATH,
    scaler_path: str = SCALER_PATH,
):
    extracted_dex_path = None
    try:
        input_path = dex_path
        if Path(dex_path).suffix.lower() == ".apk":
            print(f"[0/6] Extracting classes.dex from APK {dex_path} ...")
            extracted_dex_path = extract_dex_from_apk(dex_path)
            input_path = extracted_dex_path

        print(f"[1/6] Running baksmali dump on {input_path} ...")
        dump_text = run_baksmali_dump(input_path, baksmali_jar)

        print("[2/6] Extracting opcodes ...")
        opcodes = extract_opcodes(dump_text)
        print(f"      {len(opcodes)} opcodes extracted")

        print("[3/6] Building five-grams ...")
        fivegrams = build_fivegrams(opcodes)
        print(f"      {len(fivegrams)} five-gram instances")

        print(f"[4/6] Counting top {TOP_N_PER_FILE:,} five-grams for this file ...")
        freqs = top_fivegram_frequencies(fivegrams)
        print(f"      {len(freqs)} unique five-grams kept")

        print("[5/6] Mapping against the 10,000-column integrated reference ...")
        integrated_columns = load_integrated_columns(integrated_columns_path)
        full_row = build_full_row(freqs, integrated_columns)

        print("[5/6] Reducing to the model's trained 1000 columns ...")
        top1000_columns = load_top1000_columns(top1000_columns_path)
        feature_vector = reduce_to_top1000(full_row, top1000_columns)

        print("[6/6] Running Keras model ...")
        pred_label, confidence, per_class = classify_feature_vector(feature_vector, model_path, scaler_path)

        print("\n================ RESULT ================")
        print(f"File:        {dex_path}")
        print(f"Prediction:  {pred_label}")
        print(f"Confidence:  {confidence:.4f}")
        print("Per-class probabilities:")
        for cls, p in sorted(per_class.items(), key=lambda kv: -kv[1]):
            print(f"  {cls:<10s} {p:.4f}")
        print("==========================================\n")

        return pred_label, confidence, per_class
    finally:
        if extracted_dex_path:
            try:
                os.remove(extracted_dex_path)
            except OSError:
                pass


# ------------------------------------------------------------------
# CLI
# ------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Classify a single .dex or .apk file's malware family.")
    parser.add_argument("--dex", default=DEX_FILE_PATH, help="Path to the .dex or .apk file to classify")
    parser.add_argument("--baksmali-jar", default=BAKSMALI_PATH)
    parser.add_argument("--integrated-columns", default=INTEGRATED_FIVEGRAMS_FILE)
    parser.add_argument("--top1000-columns", default=TOP1000_COLUMNS_FILE)
    parser.add_argument("--model", default=MODEL_BUNDLE_PATH)
    parser.add_argument("--scaler", default=SCALER_PATH)
    parser.add_argument(
        "--output-json",
        metavar="RESULT_JSON",
        help="Write the result (or error, on failure) as JSON to this path. "
             "Used by the Node service instead of parsing stdout.",
    )

    # one-time setup helpers
    parser.add_argument("--extract-columns", metavar="TOP1000_CSV",
                         help="One-time: extract the ordered column list from fiveGram_matrix_top1000.csv")
    parser.add_argument("--columns-out", metavar="OUT_JSON", default=TOP1000_COLUMNS_FILE,
                         help="Where to write the extracted column list (used with --extract-columns)")
    parser.add_argument("--fit-scaler", metavar="TRAINING_CSV",
                         help="One-time: fit a StandardScaler AND extract the matching column "
                              "order from this training feature CSV (e.g. importance_1000.csv)")
    parser.add_argument("--scaler-out", metavar="OUT_JOBLIB", default=SCALER_PATH,
                         help="Where to write the fitted scaler (used with --fit-scaler)")
    parser.add_argument("--fit-scaler-columns-out", metavar="OUT_JSON", default=TOP1000_COLUMNS_FILE,
                         help="Where to write the matching column list (used with --fit-scaler)")

    args = parser.parse_args()

    if args.extract_columns:
        extract_columns_from_top1000_csv(args.extract_columns, args.columns_out)
        return

    if args.fit_scaler:
        fit_and_save_scaler(args.fit_scaler, args.scaler_out, args.fit_scaler_columns_out)
        return

    if not args.dex:
        parser.error("--dex is required unless you're running --extract-columns or --fit-scaler")

    try:
        pred_label, confidence, per_class = classify_dex_file(
            dex_path=args.dex,
            baksmali_jar=args.baksmali_jar,
            integrated_columns_path=args.integrated_columns,
            top1000_columns_path=args.top1000_columns,
            model_path=args.model,
            scaler_path=args.scaler,
        )
    except Exception as exc:  # noqa: BLE001 -- deliberately broad: any failure
        # here needs to become a structured error the caller can act on,
        # not an unhandled Python traceback on stderr.
        if args.output_json:
            with open(args.output_json, "w", encoding="utf-8") as f:
                json.dump({"error": str(exc)}, f)
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)

    if args.output_json:
        with open(args.output_json, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "predictedLabel": pred_label,
                    "confidence": confidence,
                    "perClass": per_class,
                },
                f,
            )


if __name__ == "__main__":
    main()