// CampusNav redesign — AdminBuildings.jsx — updated
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronDown,
  Download,
  Edit3,
  ImagePlus,
  Layers,
  MapPin,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { getIndustry, INDUSTRY_TYPES, resolvePoiIcon } from "../../config/poiTypes.js";
import { api } from "../../utils/api.js";
import { uploadFile } from "../../utils/supabase.js";
import { downloadQrBatchZip, sanitizeFilename } from "../../utils/zipDownload.js";

const FLOOR_PLAN_BUCKET =
  import.meta.env.VITE_SUPABASE_FLOOR_PLAN_BUCKET || "floor-plans";

async function getImageDimensions(file) {
  if (!file?.type?.startsWith("image/")) {
    return { width: null, height: null };
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const dimensions = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () =>
        resolve({
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      image.onerror = reject;
      image.src = objectUrl;
    });

    return dimensions;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function buildFloorPlanPath(buildingId, file, index = 0) {
  const extension = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf("."))
    : ".png";
  const safeName = file.name
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `buildings/${buildingId}/floor-plans/${Date.now()}-${index}-${safeName || "floor"}${extension}`;
}

function floorNameFromFile(file, fallbackLevel = 0) {
  const base = file?.name?.replace(/\.[^.]+$/, "")?.trim();
  if (base) {
    return base
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  return fallbackLevel === 0 ? "Ground Floor" : `Floor ${fallbackLevel}`;
}

function formatDate(dateValue) {
  if (!dateValue) return "Not available";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateValue));
}

function ModalShell({ title, children, onClose, width = "max-w-2xl" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-8">
      <div className={`card w-full ${width}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-[-0.02em]">{title}</h2>
          </div>
          <button onClick={onClose} className="btn-ghost px-3">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function BuildingModal({ building, onClose, onSave }) {
  const [form, setForm] = useState({
    name: building?.name || "",
    industry: building?.industry || "education",
    description: building?.description || "",
    address: building?.address || "",
    logo_url: building?.logo_url || "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    try {
      if (building) {
        await api.buildings.update(building.id, form);
        toast.success("Building updated");
      } else {
        await api.buildings.create(form);
        toast.success("Building created");
      }
      onSave();
    } catch (error) {
      toast.error(error.message || "Unable to save building");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={building ? "Edit Building" : "Add Building"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="field-label">Building Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Main Academic Block"
              required
            />
          </div>
          <div>
            <label className="field-label">Industry</label>
            <select
              className="select"
              value={form.industry}
              onChange={(event) =>
                setForm((current) => ({ ...current, industry: event.target.value }))
              }
            >
              {Object.values(INDUSTRY_TYPES).map((industry) => (
                <option key={industry.id} value={industry.id}>
                  {industry.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="field-label">Address</label>
          <input
            className="input"
            value={form.address}
            onChange={(event) =>
              setForm((current) => ({ ...current, address: event.target.value }))
            }
            placeholder="123 Campus Road"
          />
        </div>

        <div className="mt-4">
          <label className="field-label">Description</label>
          <textarea
            className="textarea"
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.target.value }))
            }
            placeholder="Describe the venue, departments, or public areas."
          />
        </div>

        <div className="mt-4">
          <label className="field-label">Logo URL</label>
          <input
            className="input"
            value={form.logo_url}
            onChange={(event) =>
              setForm((current) => ({ ...current, logo_url: event.target.value }))
            }
            placeholder="https://example.com/logo.png"
          />
          <p className="mt-2 text-xs subtle-text">
            Building world placement is handled later in the georeference step.
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : building ? "Save Changes" : "Create Building"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function FloorModal({ floor, buildingId, bulk = false, onClose, onSave }) {
  const [form, setForm] = useState({
    name: floor?.name || "",
    level: floor?.level ?? 0,
  });
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    try {
      let nextWorldPositionFloorId = null;

      if (floor) {
        let payload = { ...form };

        if (files.length > 0) {
          const file = files[0];
          const path = buildFloorPlanPath(buildingId, file);
          const url = await uploadFile(FLOOR_PLAN_BUCKET, path, file);
          const dimensions = await getImageDimensions(file);
          payload = {
            ...payload,
            floor_plan_url: url,
            floor_plan_width: dimensions.width,
            floor_plan_height: dimensions.height,
          };
        }

        const updatedFloor = await api.floors.update(floor.id, payload);
        nextWorldPositionFloorId =
          payload.floor_plan_url || updatedFloor?.floor_plan_url ? floor.id : null;
        toast.success("Floor updated");
      } else {
        if (files.length > 1 || bulk) {
          if (files.length === 0) {
            throw new Error("Select one or more floor plans to import.");
          }

          const createdFloors = [];
          for (const [index, file] of files.entries()) {
            const path = buildFloorPlanPath(buildingId, file, index);
            const url = await uploadFile(FLOOR_PLAN_BUCKET, path, file, true);
            const dimensions = await getImageDimensions(file);
            const createdFloor = await api.floors.create({
              building_id: buildingId,
              name: floorNameFromFile(file, form.level + index),
              level: form.level + index,
              floor_plan_url: url,
              floor_plan_width: dimensions.width,
              floor_plan_height: dimensions.height,
            });
            createdFloors.push(createdFloor);
          }
          nextWorldPositionFloorId = createdFloors[0]?.id || null;
          toast.success(`${files.length} floor plans imported`);
        } else {
          let payload = { ...form, building_id: buildingId };
          if (files.length === 1) {
            const file = files[0];
            const path = buildFloorPlanPath(buildingId, file);
            const url = await uploadFile(FLOOR_PLAN_BUCKET, path, file);
            const dimensions = await getImageDimensions(file);
            payload = {
              ...payload,
              floor_plan_url: url,
              floor_plan_width: dimensions.width,
              floor_plan_height: dimensions.height,
            };
          }

          const createdFloor = await api.floors.create(payload);
          nextWorldPositionFloorId =
            payload.floor_plan_url || createdFloor?.floor_plan_url
              ? createdFloor.id
              : null;
          toast.success("Floor created");
        }
      }
      onSave({
        buildingId,
        nextWorldPositionFloorId,
      });
    } catch (error) {
      toast.error(error.message || "Unable to save floor");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={
        floor
          ? "Edit Floor"
          : bulk
            ? "Import Floor Plans"
            : "Add Floor"
      }
      onClose={onClose}
      width="max-w-xl"
    >
      <form onSubmit={handleSubmit}>
        {!bulk && (
          <div>
            <label className="field-label">Floor Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Ground Floor"
              required
            />
          </div>
        )}
        <div className="mt-4">
          <label className="field-label">
            {bulk ? "Starting Level" : "Level"}
          </label>
          <input
            className="input"
            type="number"
            value={form.level}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                level: Number.parseInt(event.target.value || "0", 10),
              }))
            }
          />
          <p className="mt-2 text-sm subtle-text">
            {bulk
              ? "Imported floor plans will be created in sequence starting from this level."
              : "Use `0` for ground level, `1` for first floor, and negative values for basements."}
          </p>
        </div>
        <div className="mt-4">
          <label className="field-label">
            {floor ? "Replace Floor Plan" : bulk ? "Floor Plans" : "Floor Plan"}
          </label>
          <input
            className="input"
            type="file"
            accept="image/*,.pdf"
            multiple={!floor}
            onChange={(event) => setFiles(Array.from(event.target.files || []))}
          />
          <p className="mt-2 text-sm subtle-text">
            {bulk
              ? "Select multiple images to create several floors in one pass. Each file becomes a draft floor."
              : "Upload the floor map now so it is ready for alignment and editing in the map editor."}
          </p>
          {files.length > 0 && (
            <div className="mt-3 rounded-xl border border-default bg-surface-alt px-4 py-3 text-sm text-secondary">
              {files.length === 1 ? (
                <span>{files[0].name}</span>
              ) : (
                <div className="space-y-1">
                  <div className="font-medium text-primary">
                    {files.length} floor plans selected
                  </div>
                  <div className="max-h-32 overflow-y-auto">
                    {files.map((file) => (
                      <div key={file.name}>{file.name}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {floor?.floor_plan_url && files.length === 0 && (
            <div className="mt-3 rounded-xl border border-default bg-surface-alt px-4 py-3 text-sm text-secondary">
              Existing floor plan is attached and will remain unchanged unless you upload a replacement.
            </div>
          )}
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving
              ? "Saving..."
              : floor
                ? "Save Floor"
                : bulk
                  ? "Import Floors"
                  : "Create Floor"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ConfirmModal({ title, description, onCancel, onConfirm, confirming }) {
  return (
    <ModalShell title={title} onClose={onCancel} width="max-w-lg">
      <p className="text-sm subtle-text">{description}</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={confirming} className="btn-danger">
          {confirming ? "Deleting..." : "Delete"}
        </button>
      </div>
    </ModalShell>
  );
}

export default function AdminBuildings() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [buildings, setBuildings] = useState([]);
  const [floorsByBuilding, setFloorsByBuilding] = useState({});
  const [expandedBuildingId, setExpandedBuildingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [industryFilter, setIndustryFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [deleteState, setDeleteState] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadBuildings = async () => {
    setLoading(true);
    try {
      const data = await api.buildings.list();
      setBuildings(data || []);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load buildings");
      setBuildings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBuildings();
  }, []);

  useEffect(() => {
    const editBuildingId = searchParams.get("edit");
    if (!editBuildingId || loading || modal?.type === "building") return;

    const buildingToEdit = buildings.find((building) => building.id === editBuildingId);
    if (buildingToEdit) {
      setExpandedBuildingId(buildingToEdit.id);
      setModal({ type: "building", building: buildingToEdit });
      return;
    }

    if (!loading && buildings.length > 0) {
      const next = new URLSearchParams(searchParams);
      next.delete("edit");
      setSearchParams(next, { replace: true });
    }
  }, [buildings, loading, modal?.type, searchParams, setSearchParams]);

  const closeModal = () => {
    setModal(null);
    if (!searchParams.get("edit")) return;

    const next = new URLSearchParams(searchParams);
    next.delete("edit");
    setSearchParams(next, { replace: true });
  };

  const loadFloors = async (buildingId) => {
    const floors = await api.floors.byBuilding(buildingId).catch(() => []);
    setFloorsByBuilding((current) => ({ ...current, [buildingId]: floors }));
  };

  const moveFloor = async (buildingId, floorId, direction) => {
    const floors = [...(floorsByBuilding[buildingId] || [])].sort(
      (left, right) => left.level - right.level,
    );
    const index = floors.findIndex((floor) => floor.id === floorId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= floors.length) return;

    const current = floors[index];
    const target = floors[targetIndex];

    try {
      await Promise.all([
        api.floors.update(current.id, { level: target.level }),
        api.floors.update(target.id, { level: current.level }),
      ]);
      toast.success("Floor order updated");
      await loadFloors(buildingId);
      await loadBuildings();
    } catch (error) {
      toast.error(error.message || "Unable to reorder floors");
    }
  };

  const downloadFloorQrZip = async (building, floor) => {
    try {
      const entries = await api.qr.floor(floor.id);
      if (!entries?.length) {
        toast.error("No room QR codes are available for this floor yet.");
        return;
      }
      downloadQrBatchZip(
        entries,
        `${sanitizeFilename(building.name || "building")}-${sanitizeFilename(floor.name || "floor")}-qr.zip`,
      );
      toast.success("QR ZIP downloaded");
    } catch (error) {
      toast.error(error.message || "Unable to download floor QR ZIP");
    }
  };

  const filteredBuildings = useMemo(() => {
    return buildings.filter((building) => {
      const matchesSearch =
        !searchQuery ||
        `${building.name} ${building.address || ""} ${building.industry || ""}`
          .toLowerCase()
          .includes(searchQuery.toLowerCase());
      const matchesIndustry =
        industryFilter === "all" || (building.industry || "education") === industryFilter;
      return matchesSearch && matchesIndustry;
    });
  }, [buildings, industryFilter, searchQuery]);

  const handleToggleBuilding = async (buildingId) => {
    const next = expandedBuildingId === buildingId ? null : buildingId;
    setExpandedBuildingId(next);
    if (next && !floorsByBuilding[buildingId]) {
      await loadFloors(buildingId);
    }
  };

  const confirmDelete = async () => {
    if (!deleteState) return;
    setDeleting(true);

    try {
      if (deleteState.type === "building") {
        await api.buildings.delete(deleteState.id);
        toast.success("Building deleted");
        await loadBuildings();
      } else {
        await api.floors.delete(deleteState.id);
        toast.success("Floor deleted");
        await loadFloors(deleteState.buildingId);
      }
      setDeleteState(null);
    } catch (error) {
      toast.error(error.message || "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-page flex-col gap-6">
      <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="page-header">
          <span className="section-label">Buildings</span>
          <h1>Buildings & Floors</h1>
          <p>
            Manage building records, assign industries, create floors, and open
            the floor editor from one workspace.
          </p>
        </div>
        <button onClick={() => setModal({ type: "building" })} className="btn-primary">
          <Plus className="h-4 w-4" />
          Add Building
        </button>
      </section>

      <section className="card">
        <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
          <div>
            <label className="field-label">Search Buildings</label>
            <div className="map-editor__search">
              <Search className="h-4 w-4 text-muted" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by name, address, or industry"
              />
            </div>
          </div>
          <div>
            <label className="field-label">Filter by Industry</label>
            <select
              className="select"
              value={industryFilter}
              onChange={(event) => setIndustryFilter(event.target.value)}
            >
              <option value="all">All industries</option>
              {Object.values(INDUSTRY_TYPES).map((industry) => (
                <option key={industry.id} value={industry.id}>
                  {industry.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-xl bg-surface-alt" />
          ))}
        </div>
      ) : filteredBuildings.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="icon-chip">
              <Building2 className="h-5 w-5" />
            </div>
            <h3 className="text-xl font-semibold">No buildings yet</h3>
            <p className="max-w-md text-sm subtle-text">
              Add your first building to start mapping floors and publishing
              navigation data.
            </p>
            <button onClick={() => setModal({ type: "building" })} className="btn-primary">
              <Plus className="h-4 w-4" />
              Add Your First Building
            </button>
          </div>
        </div>
      ) : (
        filteredBuildings.map((building) => {
          const industry = getIndustry(building.industry || "education");
          const IndustryIcon = resolvePoiIcon(industry.icon);
          const floors = floorsByBuilding[building.id] || [];
          const isExpanded = expandedBuildingId === building.id;

          return (
            <article key={building.id} className="card">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex gap-4">
                  <div className="icon-chip h-12 w-12">
                    <IndustryIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold tracking-[-0.02em]">
                      {building.name}
                    </h2>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="badge-neutral">{industry.label}</span>
                      <span className="badge-neutral">
                        <Layers className="h-3.5 w-3.5" />
                        {floors.length || building.floors?.[0]?.count || 0} floors
                      </span>
                      <span className="badge-neutral">
                        <MapPin className="h-3.5 w-3.5" />
                        {building.address || "Address not added"}
                      </span>
                    </div>
                    <p className="mt-3 text-sm subtle-text">
                      Last updated {formatDate(building.updated_at)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setModal({ type: "building", building })}
                    className="btn-secondary"
                  >
                    <Edit3 className="h-4 w-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleToggleBuilding(building.id)}
                    className="btn-secondary"
                  >
                    Manage Floors
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  <button
                    onClick={() =>
                      setDeleteState({
                        type: "building",
                        id: building.id,
                        description: `Delete ${building.name} and all associated floors?`,
                      })
                    }
                    className="btn-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="mt-6 border-t border-default pt-6">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="section-label">Floors</div>
                      <p className="mt-2 text-sm subtle-text">
                        Create floors, adjust levels, and open the map editor.
                      </p>
                    </div>
                    <button
                      onClick={() => setModal({ type: "floor", buildingId: building.id })}
                      className="btn-primary"
                    >
                      <Plus className="h-4 w-4" />
                      Add Floor
                    </button>
                    <button
                      onClick={() =>
                        setModal({ type: "floor", buildingId: building.id, bulk: true })
                      }
                      className="btn-secondary"
                    >
                      <ImagePlus className="h-4 w-4" />
                      Import Floor Plans
                    </button>
                  </div>

                  {floors.length === 0 ? (
                    <div className="empty-state">
                      <div className="icon-chip">
                        <Layers className="h-5 w-5" />
                      </div>
                      <h3 className="text-lg font-semibold">No floors yet</h3>
                      <p className="max-w-md text-sm subtle-text">
                        Add the first floor to begin drawing rooms, doors,
                        waypoints, and paths.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {floors.map((floor, index) => (
                        <div
                          key={floor.id}
                          className="flex flex-col gap-4 rounded-xl border border-default bg-surface-alt p-4 lg:flex-row lg:items-center"
                        >
                          <div className="icon-chip h-10 w-10">
                            <Layers className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-primary">{floor.name}</div>
                            <div className="text-sm subtle-text">Level {floor.level}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => moveFloor(building.id, floor.id, -1)}
                              disabled={index === 0}
                              className="btn-secondary"
                              title="Move floor up"
                            >
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => moveFloor(building.id, floor.id, 1)}
                              disabled={index === floors.length - 1}
                              className="btn-secondary"
                              title="Move floor down"
                            >
                              <ArrowDown className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() =>
                                setModal({
                                  type: "floor",
                                  buildingId: building.id,
                                  floor,
                                })
                              }
                              className="btn-secondary"
                            >
                              <Edit3 className="h-4 w-4" />
                              Edit
                            </button>
                            <button
                              onClick={() =>
                                navigate(
                                  `/admin/buildings/${building.id}/floors/${floor.id}/georeference`,
                                )
                              }
                              className="btn-secondary"
                            >
                              <MapPin className="h-4 w-4" />
                              Position on World
                            </button>
                            <button
                              onClick={() =>
                                navigate(`/admin/buildings/${building.id}/floors/${floor.id}/editor`)
                              }
                              className="btn-primary"
                            >
                              Open Editor
                            </button>
                            <button
                              onClick={() => downloadFloorQrZip(building, floor)}
                              className="btn-secondary"
                            >
                              <Download className="h-4 w-4" />
                              QR ZIP
                            </button>
                            <button
                              onClick={() =>
                                setDeleteState({
                                  type: "floor",
                                  id: floor.id,
                                  buildingId: building.id,
                                  description: `Delete ${floor.name} from ${building.name}?`,
                                })
                              }
                              className="btn-danger"
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })
      )}

      {modal?.type === "building" && (
        <BuildingModal
          building={modal.building || null}
          onClose={closeModal}
          onSave={async () => {
            closeModal();
            await loadBuildings();
          }}
        />
      )}

      {modal?.type === "floor" && (
        <FloorModal
          floor={modal.floor || null}
          buildingId={modal.buildingId}
          bulk={Boolean(modal.bulk)}
          onClose={closeModal}
          onSave={async ({ buildingId, nextWorldPositionFloorId } = {}) => {
            const targetBuildingId = buildingId || modal.buildingId;
            closeModal();
            await loadFloors(targetBuildingId);
            await loadBuildings();
            if (nextWorldPositionFloorId) {
              navigate(
                `/admin/buildings/${targetBuildingId}/floors/${nextWorldPositionFloorId}/georeference`,
              );
            }
          }}
        />
      )}

      {deleteState && (
        <ConfirmModal
          title={deleteState.type === "building" ? "Delete building" : "Delete floor"}
          description={deleteState.description}
          onCancel={() => setDeleteState(null)}
          onConfirm={confirmDelete}
          confirming={deleting}
        />
      )}
    </div>
  );
}
