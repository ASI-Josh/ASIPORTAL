# Firebase Configuration Guide

## Step 1: Get Firebase Client SDK Credentials

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Click the gear icon ⚙️ > **Project Settings**
4. Scroll down to **Your apps** section
5. If no web app exists, click **Add app** > Web (</>) 
6. Copy the configuration values

You'll see something like:
```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123",
  measurementId: "G-ABC123"
};
```

## Step 2: Get Firebase Admin SDK Credentials

1. In Firebase Console > Project Settings
2. Go to **Service Accounts** tab
3. Click **Generate new private key**
4. Download the JSON file (keep it secure!)

From the JSON file, you need:
- `project_id`
- `client_email`
- `private_key`

## Step 3: Configure .env.local

Create a `.env.local` file in the root directory with these values:

```env
# Firebase Client SDK (from Step 1)
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-ABC123

# Firebase Admin SDK (from Step 2 JSON file)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Private-Key-Here\n-----END PRIVATE KEY-----\n"

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:9002
NODE_ENV=development

# Admin Emails
ADMIN_EMAILS=joshua@asi-australia.com.au,jaydan@asi-australia.com.au,bobby@asi-australia.com.au
TECHNICIAN_DOMAIN=@asi-australia.com.au
```

**Important**: For `FIREBASE_PRIVATE_KEY`, keep the entire key including the header/footer and line breaks as `\n`.

## Step 4: Enable Firebase Services

### Enable Authentication
1. Firebase Console > **Authentication**
2. Click **Get Started**
3. Go to **Sign-in method** tab
4. Enable **Email/Password** provider
5. Click **Save**

### Enable Firestore Database
1. Firebase Console > **Firestore Database**
2. Click **Create database**
3. Choose **Production mode** (we'll add security rules later)
4. Select **australia-southeast1** region
5. Click **Enable**

### Enable Cloud Storage
1. Firebase Console > **Storage**
2. Click **Get Started**
3. Start in **Production mode**
4. Choose **australia-southeast1** region
5. Click **Done**

## Step 5: Test Connection

After configuring `.env.local`, restart your dev server:

```bash
npm run dev
```

The app should start without Firebase errors. Check the browser console for any Firebase initialization errors.

## Next Steps

Once Firebase is configured:
1. ✅ Authentication system (Phase 1.3)
2. ✅ Middleware for route protection (Phase 1.4)
3. ✅ API routes (Phase 2)

---

## Troubleshooting

**Error: "Firebase: Error (auth/invalid-api-key)"**
- Check that `NEXT_PUBLIC_FIREBASE_API_KEY` is correct
- Ensure there are no extra spaces or quotes

**Error: "firebase-admin not fully configured"**
- Verify `FIREBASE_PRIVATE_KEY` includes `\n` for line breaks
- Ensure the key is wrapped in quotes in .env.local

**Build errors with environment variables**
- Restart the dev server after changing .env.local
- Clear `.next` folder: `rm -rf .next` (or `rmdir /s .next` on Windows)
