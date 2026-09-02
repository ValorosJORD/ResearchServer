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
  7. CNN_for_Malware_Data.py equiv.-> run the 5-fold CNN ensemble, print
                                      predicted family + confidence

------------------------------------------------------------------------------
IMPORTANT ONE-TIME SETUP
------------------------------------------------------------------------------
Your saved model (cnn_family_model.joblib) does NOT store which 1000 five-gram
columns it was trained on, or their order -- the StandardScalers were fit on a
plain numpy array, not a DataFrame, so `feature_names_in_` is empty. That
column list only exists as the header row of the CSV that featureImportance.py
produced (fiveGram_matrix_top1000.csv). Run this once to capture it:

    python classify_dex.py --extract-columns "D:\\fiveGram_matrix_top1000.csv" \\
                            --columns-out "D:\\top1000_columns.json"

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

import numpy as np
import joblib
import torch
import torch.nn as nn

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
MODEL_BUNDLE_PATH = os.environ.get("MODEL_BUNDLE_PATH", r"D:\cnn_family_model.joblib")

TOP_N_PER_FILE = 50_000   # matches NGramToFrequency.cpp's topN

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
# 7. CNN ensemble inference (CNN_for_Malware_Data.py equivalent)
# ------------------------------------------------------------------
class CNN1D_Classifier(nn.Module):
    """Must match CNN_for_Malware_Data.py exactly -- this is what the
    saved state_dicts were trained against."""

    def __init__(self, num_features: int, num_classes: int):
        super().__init__()
        self.conv_block = nn.Sequential(
            nn.Conv1d(1, 16, kernel_size=5, padding=2),
            nn.BatchNorm1d(16),
            nn.ReLU(),
            nn.MaxPool1d(kernel_size=2),
            nn.Conv1d(16, 32, kernel_size=5, padding=2),
            nn.BatchNorm1d(32),
            nn.ReLU(),
            nn.MaxPool1d(kernel_size=2),
        )
        pooled_length = num_features // 4
        flattened_size = 32 * pooled_length
        self.fc_block = nn.Sequential(
            nn.Linear(flattened_size, 128),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(128, num_classes),
        )

    def forward(self, x):
        x = self.conv_block(x)
        x = x.view(x.size(0), -1)
        return self.fc_block(x)


def classify_feature_vector(feature_vector: np.ndarray, model_bundle_path: str = MODEL_BUNDLE_PATH):
    """Loads the 5-fold ensemble bundle and scores ONE sample, averaging
    softmax probabilities across folds -- same logic as step 9 of
    CNN_for_Malware_Data.py, just for a single row instead of a test set."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    bundle = joblib.load(model_bundle_path)

    config = bundle["model_config"]
    label_encoder = bundle["label_encoder"]
    scalers = bundle["fold_scalers"]
    state_dicts = bundle["fold_state_dicts"]

    if feature_vector.shape[0] != config["num_features"]:
        raise ValueError(
            f"Feature vector has {feature_vector.shape[0]} values but the "
            f"model expects {config['num_features']}. Your top1000 columns "
            f"file likely doesn't match what the model was trained on."
        )

    x_row = feature_vector.reshape(1, -1)
    probs_sum = np.zeros((1, config["num_classes"]), dtype=np.float32)

    for state_dict, scaler in zip(state_dicts, scalers):
        model = CNN1D_Classifier(config["num_features"], config["num_classes"]).to(device)
        model.load_state_dict(state_dict)
        model.eval()

        x_scaled = scaler.transform(x_row).astype(np.float32)
        x_tensor = torch.tensor(x_scaled, dtype=torch.float32).unsqueeze(1).to(device)  # (1, 1, num_features)

        with torch.no_grad():
            logits = model(x_tensor)
            probs = torch.softmax(logits, dim=1).cpu().numpy()
        probs_sum += probs

    probs_avg = probs_sum / len(state_dicts)
    pred_idx = int(np.argmax(probs_avg, axis=1)[0])
    pred_label = label_encoder.inverse_transform([pred_idx])[0]
    confidence = float(probs_avg[0, pred_idx])

    per_class = {
        cls: float(p) for cls, p in zip(label_encoder.classes_, probs_avg[0])
    }
    return pred_label, confidence, per_class


# ------------------------------------------------------------------
# Orchestration
# ------------------------------------------------------------------
def classify_dex_file(
    dex_path: str,
    baksmali_jar: str = BAKSMALI_JAR,
    integrated_columns_path: str = INTEGRATED_FIVEGRAMS_FILE,
    top1000_columns_path: str = TOP1000_COLUMNS_FILE,
    model_bundle_path: str = MODEL_BUNDLE_PATH,
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

        print("[6/6] Running 5-fold CNN ensemble ...")
        pred_label, confidence, per_class = classify_feature_vector(feature_vector, model_bundle_path)

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
    parser.add_argument(
        "--output-json",
        metavar="RESULT_JSON",
        help="Write the result (or error, on failure) as JSON to this path. "
             "Used by the Node service instead of parsing stdout.",
    )

    # one-time setup helper
    parser.add_argument("--extract-columns", metavar="TOP1000_CSV",
                         help="One-time: extract the ordered column list from fiveGram_matrix_top1000.csv")
    parser.add_argument("--columns-out", metavar="OUT_JSON", default=TOP1000_COLUMNS_FILE,
                         help="Where to write the extracted column list (used with --extract-columns)")

    args = parser.parse_args()

    if args.extract_columns:
        extract_columns_from_top1000_csv(args.extract_columns, args.columns_out)
        return

    if not args.dex:
        parser.error("--dex is required unless you're running --extract-columns")

    try:
        pred_label, confidence, per_class = classify_dex_file(
            dex_path=args.dex,
            baksmali_jar=args.baksmali_jar,
            integrated_columns_path=args.integrated_columns,
            top1000_columns_path=args.top1000_columns,
            model_bundle_path=args.model,
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