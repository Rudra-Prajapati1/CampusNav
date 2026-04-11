from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from pipeline import trace_floor_plan

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
    return {"status": "ok", "service": "campusnav-ai-trace"}


@app.post("/trace")
async def trace(
    file: UploadFile = File(...),
    options: str = Form("{}"),
):
    try:
        content = await file.read()
        result = trace_floor_plan(content, file.filename or "upload.png", options)
        return JSONResponse(result)
    except Exception as exc:  # pragma: no cover - handled by API
        return JSONResponse(
            status_code=400,
            content={
                "error": "AI trace failed",
                "message": str(exc),
                "walls": [],
                "doors": [],
                "windows": [],
                "rooms": [],
                "nodes": [],
                "edges": [],
                "objects": [],
            },
        )
