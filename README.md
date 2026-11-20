# Idoma Medical Phrasebook & Clinical Communication Application

A clinical history-taking and bedside communication guide designed specifically for medical trainees, doctors, nurses, and healthcare workers serving Idoma-speaking communities in Benue State and beyond.

Developed at the **Department of Medicine and Surgery, Federal University of Health Sciences, Otukpo (FUHSO)**.

---

## ⚠️ Language & Clinical Advisory

**Idoma is a tonal language.** Pitch patterns directly alter word meaning. Written spelling, syllable breakdowns, and phonetic cues in this phrasebook serve as learning anchors—**always verify pronunciation aloud with a native speaker before direct bedside clinical use.**

---

## 📌 Project Overview

Reference guides for clinical history-taking in Hausa, Yoruba, and Igbo have long circulated in Nigerian medical education, but no comparable resource for Idoma was widely available—despite millions of Idoma speakers across Benue State and surrounding regions. 

With FUHSO's early medical cohorts entering clinical rotations, this tool closes that gap by offering:
* A structured clinical history-taking phrasebook (Anatomy, Biodata, Presenting Complaints, Systems, OB/GYN, Pediatrics, Vitals, and Consent).
* **High-Contrast Bedside Focus Mode** for fast lookup during ward rounds.
* **Listen Mode**: An acoustic pattern candidate matcher and closed-loop visual response card system for patient interactions.
* **Active Recall Drills**: Flashcard testing for clinical trainees.
* **Contributor & Audio Studio**: A browser-based recording system for native speakers to attach spoken audio clips directly to clinical terms.
* **Supabase Cloud Backend**: Admin approval workflows, contributor access codes, and dynamic credits.

---

## 📁 Repository Structure

```text
idoma-medical-phrasebook/
├── README.md               # Project documentation & disclaimer
├── index.html              # Main HTML application shell
├── css/
│   └── styles.css          # Styling, dark bedside mode & components
├── js/
│   ├── config.js           # Supabase connection credentials
│   ├── db.js               # Supabase queries & offline fallback engine
│   ├── audio-matcher.js    # Listen mode acoustic matcher & response cards
│   └── app.js              # Application logic, tabs, search & UI binding
├── data/
│   └── seed-phrases.json   # Seed phrase dataset parsed from clinical PDF
└── supabase/
    └── schema.sql          # Database tables, policies, & storage configuration
```

---

## 🚀 Quick Setup Instructions

### 1. Host on GitHub Pages
1. Push all files to your GitHub repository.
2. Go to **Repository Settings** -> **Pages**.
3. Under **Branch**, select `main` (or `master`) and folder `/ (root)`.
4. Click **Save**. Your app will be live at `https://<username>.github.io/<repo-name>/`.

### 2. Connect Supabase Database
1. In your Supabase Dashboard, navigate to **SQL Editor**.
2. Run the SQL script from `supabase/schema.sql`.
3. Open `js/config.js` and update your project URL and public key:
   ```javascript
   const SUPABASE_URL = "https://your-supabase-id.supabase.co";
   const SUPABASE_ANON_KEY = "your-supabase-anon-key";
   ```
4. Update the default contributor access codes in the `contributors` table for your team members.

---

## 👥 Authors & Contributors

* **Lead Author:** Alex Sunday Okoh (300-level Medical Student, FUHSO)
* **Translation:** Grace Adini
* **Dialect Review:** Ben Odeh
* **Clinical Accuracy Review:** Dr Jude A
* **Proofreading:** James Gabriel
* **Special Thanks:** CMDA FUHSTHO, Dr. Eli,Dr Otene and native speakers across Benue State.

---

## ⚖️ License & Copyright

© 2026 Department of Medicine & Surgery, Federal University of Health Sciences, Otukpo (FUHSO). All rights reserved.