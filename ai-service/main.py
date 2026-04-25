import asyncio

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from pipeline import runtime_status_message, trace_floor_plan, warmup_model

app = FastAPI(title="CampusNav AI Trace Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "campusnav-ai-trace",
        "modelStatus": runtime_status_message(),
    }


@app.on_event("startup")
async def startup_event():
    ready = warmup_model()
    if ready:
        print("CubiCasa model loaded")
    else:
        print("CubiCasa model unavailable; emergency OpenCV fallback ready")
    print(runtime_status_message())


@app.post("/trace")
async def trace(
    file: UploadFile = File(...),
    options: str = Form("{}"),
):
    try:
        content = await file.read()
        result = await asyncio.to_thread(
            trace_floor_plan,
            content,
            file.filename or "upload.png",
            options,
        )
        return JSONResponse(result)
    except Exception as exc:  # pragma: no cover - handled by API
        return JSONResponse(
            status_code=400,
            content={
                "error": "AI trace failed",
                "message": str(exc),
                "spaces": {"type": "FeatureCollection", "features": []},
                "obstructions": {"type": "FeatureCollection", "features": []},
                "openings": {"type": "FeatureCollection", "features": []},
                "nodes": {"type": "FeatureCollection", "features": []},
                "objects": {"type": "FeatureCollection", "features": []},
                "meta": {},
            },
        )
