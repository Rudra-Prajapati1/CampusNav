// CampusNav redesign — poiTypes.js — updated
import {
  ActivitySquare,
  ArrowUpDown,
  Bath,
  BedDouble,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  Clapperboard,
  ClipboardList,
  ConciergeBell,
  CreditCard,
  DoorOpen,
  FlaskConical,
  Footprints,
  GraduationCap,
  HeartPulse,
  Hotel,
  Info,
  LayoutDashboard,
  LayoutGrid,
  Library,
  Mic2,
  MoveUpRight,
  ParkingCircle,
  Pill,
  Presentation,
  ScanLine,
  Server,
  ShoppingBag,
  Siren,
  Stethoscope,
  Store,
  Tag,
  Users,
  UtensilsCrossed,
} from "lucide-react";

export const ICON_REGISTRY = {
  ActivitySquare,
  ArrowUpDown,
  Bath,
  BedDouble,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  Clapperboard,
  ClipboardList,
  ConciergeBell,
  CreditCard,
  DoorOpen,
  FlaskConical,
  Footprints,
  GraduationCap,
  HeartPulse,
  Hotel,
  Info,
  LayoutDashboard,
  LayoutGrid,
  Library,
  Mic2,
  MoveUpRight,
  ParkingCircle,
  Pill,
  Presentation,
  ScanLine,
  Server,
  ShoppingBag,
  Siren,
  Stethoscope,
  Store,
  Tag,
  Users,
  UtensilsCrossed,
};

function roomType(id, label, icon, options = {}) {
  return { id, label, icon, ...options };
}

export const INDUSTRY_TYPES = {
  education: {
    id: "education",
    label: "Education",
    icon: "GraduationCap",
    roomTypes: [
      roomType("classroom", "Classroom", "BookOpen"),
      roomType("lab", "Laboratory", "FlaskConical"),
      roomType("library", "Library", "Library"),
      roomType("office", "Office", "Briefcase"),
      roomType("cafeteria", "Cafeteria", "UtensilsCrossed"),
      roomType("restroom", "Restroom", "Bath"),
      roomType("auditorium", "Auditorium", "Mic2"),
      roomType("parking", "Parking", "ParkingCircle"),
      roomType("emergency_exit", "Emergency Exit", "DoorOpen"),
      roomType("elevator", "Elevator", "ArrowUpDown", { navRole: "elevator" }),
      roomType("stairs", "Stairs", "Footprints", { navRole: "stairs" }),
      roomType("custom", "Custom", "Tag", { isCustom: true }),
    ],
  },
  healthcare: {
    id: "healthcare",
    label: "Healthcare",
    icon: "HeartPulse",
    roomTypes: [
      roomType("ward", "Ward", "BedDouble"),
      roomType("icu", "ICU", "ActivitySquare"),
      roomType("ot", "Operation Theatre", "Stethoscope"),
      roomType("pharmacy", "Pharmacy", "Pill"),
      roomType("radiology", "Radiology", "ScanLine"),
      roomType("emergency", "Emergency", "Siren"),
      roomType("reception", "Reception", "ClipboardList"),
      roomType("restroom", "Restroom", "Bath"),
      roomType("cafeteria", "Cafeteria", "UtensilsCrossed"),
      roomType("elevator", "Elevator", "ArrowUpDown", { navRole: "elevator" }),
      roomType("stairs", "Stairs", "Footprints", { navRole: "stairs" }),
      roomType("parking", "Parking", "ParkingCircle"),
      roomType("custom", "Custom", "Tag", { isCustom: true }),
    ],
  },
  mall: {
    id: "mall",
    label: "Shopping Mall",
    icon: "ShoppingBag",
    roomTypes: [
      roomType("store", "Store", "Store"),
      roomType("food_court", "Food Court", "UtensilsCrossed"),
      roomType("restroom", "Restroom", "Bath"),
      roomType("atm", "ATM", "CreditCard"),
      roomType("info_desk", "Info Desk", "Info"),
      roomType("parking", "Parking", "ParkingCircle"),
      roomType("elevator", "Elevator", "ArrowUpDown", { navRole: "elevator" }),
      roomType("escalator", "Escalator", "MoveUpRight"),
      roomType("cinema", "Cinema", "Clapperboard"),
      roomType("emergency_exit", "Emergency Exit", "DoorOpen"),
      roomType("stairs", "Stairs", "Footprints", { navRole: "stairs" }),
      roomType("custom", "Custom", "Tag", { isCustom: true }),
    ],
  },
  corporate: {
    id: "corporate",
    label: "Corporate Office",
    icon: "Building2",
    roomTypes: [
      roomType("meeting_room", "Meeting Room", "Users"),
      roomType("open_office", "Open Office", "LayoutDashboard"),
      roomType("cabin", "Cabin", "Briefcase"),
      roomType("reception", "Reception", "ClipboardList"),
      roomType("cafeteria", "Cafeteria", "UtensilsCrossed"),
      roomType("server_room", "Server Room", "Server"),
      roomType("restroom", "Restroom", "Bath"),
      roomType("elevator", "Elevator", "ArrowUpDown", { navRole: "elevator" }),
      roomType("stairs", "Stairs", "Footprints", { navRole: "stairs" }),
      roomType("parking", "Parking", "ParkingCircle"),
      roomType("custom", "Custom", "Tag", { isCustom: true }),
    ],
  },
  events: {
    id: "events",
    label: "Events & Venues",
    icon: "CalendarDays",
    roomTypes: [
      roomType("hall", "Hall", "Mic2"),
      roomType("booth", "Booth / Stall", "LayoutGrid"),
      roomType("stage", "Stage", "Presentation"),
      roomType("registration", "Registration", "ClipboardList"),
      roomType("restroom", "Restroom", "Bath"),
      roomType("food_zone", "Food Zone", "UtensilsCrossed"),
      roomType("parking", "Parking", "ParkingCircle"),
      roomType("emergency_exit", "Emergency Exit", "DoorOpen"),
      roomType("stairs", "Stairs", "Footprints", { navRole: "stairs" }),
      roomType("custom", "Custom", "Tag", { isCustom: true }),
    ],
  },
  hospitality: {
    id: "hospitality",
    label: "Hospitality",
    icon: "Hotel",
    roomTypes: [
      roomType("guest_room", "Guest Room", "BedDouble"),
      roomType("lobby", "Lobby", "ConciergeBell"),
      roomType("banquet_hall", "Banquet Hall", "Mic2"),
      roomType("restaurant", "Restaurant", "UtensilsCrossed"),
      roomType("conference_room", "Conference Room", "Users"),
      roomType("spa", "Spa", "HeartPulse"),
      roomType("restroom", "Restroom", "Bath"),
      roomType("parking", "Parking", "ParkingCircle"),
      roomType("elevator", "Elevator", "ArrowUpDown", { navRole: "elevator" }),
      roomType("stairs", "Stairs", "Footprints", { navRole: "stairs" }),
      roomType("custom", "Custom", "Tag", { isCustom: true }),
    ],
  },
};

export const DEFAULT_INDUSTRY = "education";

export function getIndustry(industryId) {
  return INDUSTRY_TYPES[industryId] || INDUSTRY_TYPES[DEFAULT_INDUSTRY];
}

export function getRoomTypes(industryId) {
  return getIndustry(industryId).roomTypes;
}

export function getRoomTypeMeta(industryId, typeId) {
  if (!typeId) return null;
  return (
    getRoomTypes(industryId).find((entry) => entry.id === typeId) ||
    roomType(typeId, typeId, "Tag", { isCustom: true })
  );
}

export function resolvePoiIcon(iconName) {
  return ICON_REGISTRY[iconName] || Tag;
}

export function formatRoomTypeLabel(typeId) {
  if (!typeId) return "Unspecified";
  return typeId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
