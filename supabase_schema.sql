-- ============================================
-- CampusNav - Complete Database Schema
-- Run this in your Supabase SQL Editor
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- ADMINS TABLE
-- Only users listed here can access admin panel
-- ============================================
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security for admins
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view admin list" ON admins
  FOR SELECT USING (auth.uid() IN (SELECT user_id FROM admins));

-- ============================================
-- BUILDINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS buildings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  address TEXT,
  logo_url TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
-- Public can read buildings
CREATE POLICY "Public can read buildings" ON buildings FOR SELECT USING (true);
-- Only admins can write
CREATE POLICY "Admins can manage buildings" ON buildings
  FOR ALL USING (auth.uid() IN (SELECT user_id FROM admins));

-- ============================================
-- FLOORS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS floors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id UUID REFERENCES buildings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0, -- 0 = ground, 1 = first, -1 = basement
  floor_plan_url TEXT,
  floor_plan_width FLOAT,
  floor_plan_height FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE floors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read floors" ON floors FOR SELECT USING (true);
CREATE POLICY "Admins can manage floors" ON floors
  FOR ALL USING (auth.uid() IN (SELECT user_id FROM admins));

-- ============================================
-- ROOMS TABLE
-- Each room/space within a floor
-- ============================================
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  floor_id UUID REFERENCES floors(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Unnamed',
  type TEXT NOT NULL DEFAULT 'other', -- classroom, lab, office, toilet, stairs, elevator, entrance, canteen, corridor, other
  x FLOAT NOT NULL DEFAULT 0,
  y FLOAT NOT NULL DEFAULT 0,
  width FLOAT NOT NULL DEFAULT 100,
  height FLOAT NOT NULL DEFAULT 80,
  color TEXT,
  description TEXT,
  photo_urls TEXT[], -- Array of photo URLs for future street-view feature
  polygon_points JSONB, -- For future non-rectangular rooms
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read rooms" ON rooms FOR SELECT USING (true);
CREATE POLICY "Admins can manage rooms" ON rooms
  FOR ALL USING (auth.uid() IN (SELECT user_id FROM admins));

-- ============================================
-- WAYPOINTS TABLE
-- Navigation graph nodes (auto-generated or manual)
-- ============================================
CREATE TABLE IF NOT EXISTS waypoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  floor_id UUID REFERENCES floors(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  x FLOAT NOT NULL,
  y FLOAT NOT NULL,
  type TEXT DEFAULT 'room_center', -- room_center, corridor, stairs, elevator, entrance, manual
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE waypoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read waypoints" ON waypoints FOR SELECT USING (true);
CREATE POLICY "Admins can manage waypoints" ON waypoints
  FOR ALL USING (auth.uid() IN (SELECT user_id FROM admins));

-- ============================================
-- WAYPOINT CONNECTIONS TABLE
-- Edges in the navigation graph
-- ============================================
CREATE TABLE IF NOT EXISTS waypoint_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  floor_id UUID REFERENCES floors(id) ON DELETE CASCADE,
  waypoint_a_id UUID REFERENCES waypoints(id) ON DELETE CASCADE,
  waypoint_b_id UUID REFERENCES waypoints(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE waypoint_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read connections" ON waypoint_connections FOR SELECT USING (true);
CREATE POLICY "Admins can manage connections" ON waypoint_connections
  FOR ALL USING (auth.uid() IN (SELECT user_id FROM admins));

-- ============================================
-- INDEXES for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_floors_building_id ON floors(building_id);
CREATE INDEX IF NOT EXISTS idx_rooms_floor_id ON rooms(floor_id);
CREATE INDEX IF NOT EXISTS idx_waypoints_floor_id ON waypoints(floor_id);
CREATE INDEX IF NOT EXISTS idx_waypoints_room_id ON waypoints(room_id);
CREATE INDEX IF NOT EXISTS idx_connections_floor_id ON waypoint_connections(floor_id);
CREATE INDEX IF NOT EXISTS idx_connections_a ON waypoint_connections(waypoint_a_id);
CREATE INDEX IF NOT EXISTS idx_connections_b ON waypoint_connections(waypoint_b_id);
CREATE INDEX IF NOT EXISTS idx_rooms_name ON rooms USING gin(to_tsvector('english', name));

-- ============================================
-- AUTO-UPDATE updated_at timestamps
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER buildings_updated_at BEFORE UPDATE ON buildings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER floors_updated_at BEFORE UPDATE ON floors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER rooms_updated_at BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- STORAGE BUCKET (run separately in Supabase Storage settings or here)
-- ============================================
-- INSERT INTO storage.buckets (id, name, public) VALUES ('campusnav-assets', 'campusnav-assets', true);
-- CREATE POLICY "Public can read assets" ON storage.objects FOR SELECT USING (bucket_id = 'campusnav-assets');
-- CREATE POLICY "Admins can upload assets" ON storage.objects FOR INSERT
--   WITH CHECK (bucket_id = 'campusnav-assets' AND auth.uid() IN (SELECT user_id FROM admins));

-- ============================================
-- INSERT YOUR ADMIN EMAILS HERE
-- Replace with your actual Google email addresses
-- ============================================
-- INSERT INTO admins (email) VALUES ('your.email@gmail.com');
-- INSERT INTO admins (email) VALUES ('partner.email@gmail.com');

-- ============================================
-- TRIGGER: Auto-link admin user_id after first login
-- ============================================
CREATE OR REPLACE FUNCTION link_admin_user()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE admins SET user_id = NEW.id WHERE email = NEW.email AND user_id IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION link_admin_user();

-- ============================================
-- CURRENT AUTH SETUP: Email + Password
-- (No Google Console needed right now)
-- ============================================
-- After running schema above, go to:
-- Supabase Dashboard → Authentication → Users → "Invite User"
-- Enter your email → you'll get a magic link to set your password
-- Then insert into admins table:
--
--   INSERT INTO admins (email) VALUES ('your@email.com');
--   INSERT INTO admins (email) VALUES ('partner@email.com');
--
-- The trigger above will auto-link user_id once you log in.
--
-- FUTURE: When Google Console is ready:
-- Go to Supabase → Authentication → Providers → Google → Enable
-- The signInWithGoogle() function in authStore.js is already coded!
