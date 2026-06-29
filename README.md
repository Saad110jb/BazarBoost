# BazaarBoost

**The Intelligent, Ad-Driven Multi-Tenant Marketplace for Local Commerce**

BazaarBoost is a comprehensive, multi-tenant Software-as-a-Service (SaaS) e-commerce platform custom-tailored for local vendor ecosystems. Unlike traditional global SaaS models that rely on monthly credit card subscriptions, BazaarBoost monetizes via a Manual Bank Transfer Ad-Promotion Bidding/Slot System.

The platform utilizes lightweight, open-source, locally hosted AI models to eliminate external API costs while offering high-end features like automated product tagging, OCR-based fraud detection for payment receipts, and smart product recommendations.

## Architecture

This project is organized as a monorepo:
- `bazaar-frontend/`: Next.js frontend with role-based dashboards (Shopper, Vendor, Admin), custom multi-tenant storefronts, and Recharts analytics.
- `bazaar-backend/`: Node.js & Express REST API and Socket.io negotiation server. Integrates Tesseract.js (OCR) and `@xenova/transformers` (local AI model inference).

---

## Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [Docker](https://www.docker.com/) (to run local MongoDB easily)

### 2. Run Database
Start local MongoDB and Mongo Express dashboard via Docker Compose:
```bash
docker compose up -d
```
- MongoDB URL: `mongodb://localhost:27017/bazaarboost`
- Mongo Express: `http://localhost:8081` (Username: `admin`, Password: `password`)

### 3. Install Dependencies
Run from the root directory to install all packages for both workspaces:
```bash
npm install
```

### 4. Set Up Environment Variables
- In `bazaar-backend/`, copy `.env.example` to `.env` and fill in details.
- In `bazaar-frontend/`, copy `.env.example` to `.env.local` if needed.

### 5. Run Development Servers
From the root directory:
```bash
npm run dev
```
This runs:
- Frontend on `http://localhost:3000`
- Backend on `http://localhost:5000`

### 6. Create Database Indexes (First Deployment Only)
Run the one-shot index migration script while MongoDB is running:
```bash
npm run db:indexes -w bazaar-backend
```
This creates all B-tree, compound, multikey, and unique indexes defined in the schema integrity specification.
It is **idempotent** — safe to run again without duplicating indexes.

---

## Key Features & How They Work

### A. Real-Time Chat & Negotiation (Socket.io)
Shoppers and Vendors can negotiate product prices. When an offer is submitted, Socket.io broadcasts the proposed price, updating the chat UI live.

### B. Manual Bank Transfer Ad Bidding System
Vendors bid on slots for homepage visibility. Instead of credit card subscriptions, vendors transfer cash manually and upload their bank slip receipt. Admins review pending transfers in their dashboard.

### C. Local AI Pipeline (No API Costs)
- **OCR Receipt Analysis**: Node backend uses `Tesseract.js` to read text from uploaded receipt images, check for keywords, amount, and reference numbers, and identify potential fraud.
- **Automated Product Tagging**: Backend uses `@xenova/transformers` (running local zero-shot classification) to automatically generate product categories and tags from titles and descriptions.
- **Smart Recommendations**: Uses sentence embeddings via `@xenova/transformers` to calculate cosine similarities between products and suggest related items to shoppers.
