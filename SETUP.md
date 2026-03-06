# CampusNav - Complete Setup Guide

## 🏗️ Tech Stack
- **Frontend**: React + Vite + Tailwind CSS + Konva.js (Canvas rendering)
- **Backend**: Node.js + Express
- **Database / Auth / Storage**: Supabase (FREE tier)
- **Pathfinding**: Dijkstra's Algorithm
- **Hosting**: Vercel (frontend) + Render (backend) — both FREE

---

## STEP 1: Supabase Setup (5 minutes)

1. Go to https://supabase.com and create a free account
2. Click **New Project** → name it `campusnav`
3. Choose a region close to India (e.g., Southeast Asia)
4. Once project loads, go to **SQL Editor**
5. Copy the entire contents of `supabase_schema.sql` and run it
6. Then add your admin emails at the bottom (replace the example):
   ```sql
   INSERT INTO admins (email) VALUES ('your.email@gmail.com');
   INSERT INTO admins (email) VALUES ('partner.email@gmail.com');
   ```

### Get your Supabase keys:
- Go to **Project Settings → API**
- Copy `Project URL` → this is `SUPABASE_URL`
- Copy `anon public` key → this is `SUPABASE_ANON_KEY`
- Copy `service_role secret` key → this is `SUPABASE_SERVICE_ROLE_KEY`

### Enable Google OAuth:
1. Go to **Authentication → Providers → Google**
2. Enable it
3. Go to https://console.cloud.google.com
4. Create a new project → Enable Google OAuth API
5. Create OAuth credentials (Web Application)
6. Add authorized redirect URI: `https://your-project.supabase.co/auth/v1/callback`
7. Copy Client ID and Secret back into Supabase

### Create Storage Bucket:
1. Go to **Storage** in Supabase
2. Create bucket named `campusnav-assets`
3. Set it to **Public**
4. Add policies (or run the commented SQL in schema file)

---

## STEP 2: Local Development

### Backend
```bash
cd backend
npm install
cp .env.example .env
# Fill in your Supabase credentials in .env
npm run dev
# Runs on http://localhost:3001
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env
# Fill in your Supabase credentials in .env
npm run dev
# Runs on http://localhost:5173
```

---

## STEP 3: Deploy to Production (FREE)

### Deploy Backend to Render:
1. Push your code to GitHub
2. Go to https://render.com → New Web Service
3. Connect your GitHub repo → select `backend` folder
4. Set root directory to `backend`
5. Build command: `npm install`
6. Start command: `npm start`
7. Add environment variables (from your .env)
8. Deploy! Get your backend URL (e.g., `https://campusnav-api.onrender.com`)

### Deploy Frontend to Vercel:
1. Go to https://vercel.com → Import GitHub repo
2. Set root directory to `frontend`
3. Add environment variables:
   - `VITE_SUPABASE_URL` = your Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
   - `VITE_API_URL` = your Render backend URL + `/api`
4. Deploy! Get your frontend URL

### Update CORS:
- In `backend/.env`, set `FRONTEND_URL` to your Vercel URL
- In Supabase OAuth settings, add your Vercel URL as allowed redirect

---

## 📱 How to Use

### Admin Flow:
1. Go to `/admin/login` → Sign in with Google
2. Go to **Buildings** → Create a new building
3. Add floors to the building
4. Click **Edit Map** on a floor
5. **Option A**: Click "Upload Plan" to upload a floor plan image as background
6. **Option B**: Select "Draw Room" tool → drag to draw rooms
7. Label each room, set type (classroom, lab, etc.)
8. Click **Auto Nav** to auto-generate navigation waypoints
9. Click **Save Map**
10. For each room: select it → "Generate QR Code" → Download and print!

### User Flow:
1. User scans a QR code placed in a room
2. Website opens at `/navigate/{buildingId}?from={roomId}`
3. Their starting location is pre-set on the map
4. They search for their destination
5. Tap "Get Directions" → animated path appears!

---

## 🗺️ Map Editor Tools

| Tool | Icon | Usage |
|------|------|-------|
| Select | Arrow | Click rooms to select, drag to move |
| Draw Room | Square | Drag to draw new rooms |
| Add Waypoint | Dot | Click to place manual nav waypoints |
| Connect | Line | Click two waypoints to connect them |
| Auto Nav | Button | Auto-generates waypoints from all rooms |
| Upload Plan | Button | Upload floor plan image as background |

---

## 🔮 Future Features (Planned)
- Indoor photo previews (like Google Street View) per room
- Multi-language support (Gujarati, Hindi)
- Mobile app (React Native)
- Analytics dashboard (visitor heatmaps)
- Accessibility routing (wheelchair-friendly paths)
- Real-time occupancy integration

---

## 💰 Free Tier Limits
- **Supabase**: 500MB DB, 1GB storage, 50MB file uploads — plenty for starting
- **Render**: 750 hours/month free (may sleep after inactivity, upgrade for always-on)
- **Vercel**: Unlimited static deployments, 100GB bandwidth/month

---

## 🆘 Need Help?
Common issues:
- **CORS errors**: Make sure FRONTEND_URL in backend .env matches exactly
- **Auth not working**: Check Google OAuth redirect URIs in Google Console
- **QR codes not generating**: Make sure rooms are saved before generating QR
- **Path not found**: Run "Auto Nav" in floor editor after drawing rooms, then Save
