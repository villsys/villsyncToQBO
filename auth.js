import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyD982CXdXF_hj0C8BlD5nc1CDVWj6oYg3A",
  authDomain: "vilsync-to-qbo.firebaseapp.com",
  projectId: "vilsync-to-qbo",
  storageBucket: "vilsync-to-qbo.firebasestorage.app",
  messagingSenderId: "385067886379",
  appId: "1:385067886379:web:2ce4d922b3ffe2ff2d076e",
  measurementId: "G-04R1T85DDK"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const functions = getFunctions(app);
