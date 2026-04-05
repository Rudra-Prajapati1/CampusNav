import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";

async function downloadFloorPlan(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to download floor plan: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "campusnav-floor-"));
  const imagePath = path.join(tempDir, "floor-plan.png");
  await fs.writeFile(imagePath, bytes);
  return { tempDir, imagePath };
}

function runPythonTrace(imagePath) {
  const scriptPath = path.resolve(
    process.cwd(),
    "src",
    "scripts",
    "auto_trace_floor_plan.py",
  );

  return new Promise((resolve, reject) => {
    const child = spawn("python", [scriptPath, imagePath], {
      cwd: path.resolve(process.cwd()),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Auto trace failed with exit code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Auto trace returned invalid JSON. ${error.message}`));
      }
    });
  });
}

export async function autoTraceFloorPlan(floorPlanUrl) {
  if (!floorPlanUrl) {
    throw new Error("Attach a floor plan image before running auto trace.");
  }

  const { tempDir, imagePath } = await downloadFloorPlan(floorPlanUrl);

  try {
    return await runPythonTrace(imagePath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export default autoTraceFloorPlan;
