# CubiCasa Weights

CampusNav expects the official CubiCasa5K model weights at:

```text
ai-service/models/model_best_val_loss_var.pkl
```

Download the weights from the official CubiCasa5K README link:

```text
https://drive.google.com/file/d/1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK/view?usp=sharing
```

Or, from the WSL venv:

```bash
python download_cubicasa_weights.py
```

If you keep the file elsewhere, set:

```bash
export CUBICASA_WEIGHTS_PATH=/absolute/path/to/model_best_val_loss_var.pkl
```

Runtime tuning knobs:

```bash
export CUBICASA_INPUT_SIZE=256
export TRACE_WORKING_MAX_DIM=768
```

Do not commit `.pkl`, `.pth`, `.pt`, or `.onnx` model files.
