// ═══════════════════════════════════════════════════════════
//  FIREBASE CONFIG
//  Replace these placeholder values with your own Firebase
//  project credentials. See HOSTING-INSTRUCTIONS.md for steps.
// ═══════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyBRlRt33vfgT6VZZHf0QLH7kQnr7GgcOyU",
  authDomain:        "fitness-tracker-f5383.firebaseapp.com",
  projectId:         "fitness-tracker-f5383",
  storageBucket:     "fitness-tracker-f5383.firebasestorage.app",
  messagingSenderId: "728604036946",
  appId:             "1:728604036946:web:079130b4ed0b47c1d7348b"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
