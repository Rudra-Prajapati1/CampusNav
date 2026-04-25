from pathlib import Path

import gdown

FILE_ID = "1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK"
OUTPUT = Path(__file__).resolve().parent / "models" / "model_best_val_loss_var.pkl"


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    result = gdown.download(id=FILE_ID, output=str(OUTPUT), quiet=False)
    if not result or not OUTPUT.exists() or OUTPUT.stat().st_size == 0:
        raise RuntimeError(
            "Unable to download CubiCasa weights from Google Drive. "
            "Download manually from "
            "https://drive.google.com/file/d/1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK/view?usp=sharing "
            f"and place the file at {OUTPUT}."
        )
    print(f"Downloaded CubiCasa weights to {OUTPUT}")


if __name__ == "__main__":
    main()
