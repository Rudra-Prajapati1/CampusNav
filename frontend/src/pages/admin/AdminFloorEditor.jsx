import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { api } from "../../utils/api.js";
import MapEditor from "../../components/MapEditor.jsx";
import toast from "react-hot-toast";

export default function AdminFloorEditor() {
  const { buildingId, floorId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [floorName, setFloorName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadFloor() {
      try {
        const data = await api.floors.get(floorId);
        setFloorName(data.name);
        if (data.map_data) {
          localStorage.setItem("campusnav-editor", JSON.stringify(data.map_data));
        } else {
          localStorage.removeItem("campusnav-editor");
        }
      } catch (err) {
        toast.error("Failed to load floor: " + err.message);
      } finally {
        setLoading(false);
      }
    }
    loadFloor();
  }, [floorId]);

  const handleSave = useCallback(
    async ({ rooms, waypoints, connections, map_data, scale_pixels_per_meter }) => {
      setSaving(true);
      try {
        await api.floors.saveMap(floorId, {
          rooms,
          waypoints,
          connections,
          scale_pixels_per_meter,
        });
        await api.floors.update(floorId, { map_data });
        toast.success("Map saved!");
      } catch (err) {
        toast.error("Failed to save: " + err.message);
      } finally {
        setSaving(false);
      }
    },
    [floorId],
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          height: "40px",
          background: "#0f1117",
          borderBottom: "1px solid #2a3450",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: "12px",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => navigate("/admin/buildings")}
          style={{
            color: "#8892b0",
            fontSize: "12px",
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          {"<- Back to Buildings"}
        </button>
        <span style={{ color: "#4a5568", fontSize: "12px" }}>|</span>
        <span style={{ color: "#e8eaf6", fontSize: "12px", fontWeight: 500 }}>
          Editing: {floorName}
        </span>
        {saving && (
          <span
            style={{ color: "#4f6ef7", fontSize: "11px", marginLeft: "auto" }}
          >
            Saving...
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <MapEditor buildingId={buildingId} floorId={floorId} onSave={handleSave} />
      </div>
    </div>
  );
}
