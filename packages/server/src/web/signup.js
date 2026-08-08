// Signup / sign-in — Firebase handles the actual auth (email/password +
// Google, both with built-in verified-email tracking); this page's job is
// just driving the UI and handing the resulting ID token to
// /api/auth/firebase/complete, which is the only thing that actually issues
// a license (server-verified, never decided here).

const $ = (s) => document.querySelector(s);
const KEY_STORE = "lyceum_license_key";
let mode = "signup"; // "signup" | "signin"

async function loadFirebase() {
  const configRes = await fetch("/api/firebase-config");
  if (!configRes.ok) {
    throw new Error("Signup isn't configured yet — check back soon.");
  }
  const config = await configRes.json();

  // Loaded from Google's own CDN, not bundled — this project ships plain
  // ES modules everywhere, no build step for the frontend.
  const [{ initializeApp }, authMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js"),
  ]);

  const app = initializeApp(config);
  const auth = authMod.getAuth(app);
  return { auth, authMod };
}

function setError(msg) {
  $("#signupError").textContent = msg ?? "";
}

async function finishWithUser(auth, authMod, user, name) {
  // A freshly created email/password user isn't verified yet — Firebase
  // sends the email itself; getIdToken(true) below is a force-refresh so a
  // user who verifies and comes straight back doesn't see a stale claim.
  await user.reload();
  const idToken = await user.getIdToken(true);

  const res = await fetch("/api/auth/firebase/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken, name: name ?? user.displayName ?? "" }),
  });
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    setError(json.message ?? "Something went wrong.");
    return;
  }

  if (!json.verified) {
    if (!user.emailVerified) {
      try {
        await authMod.sendEmailVerification(user);
      } catch {
        // Already sent recently, or rate-limited — not fatal, the message below still applies.
      }
    }
    renderVerifyPending(auth, authMod, user, name);
    return;
  }

  localStorage.setItem(KEY_STORE, json.licenseKey);
  $("#signupCard").innerHTML = `<h2>You're in.</h2><p class="sub">Taking you to setup…</p>`;
  setTimeout(() => {
    location.href = "/web/redeem";
  }, 900);
}

function renderVerifyPending(auth, authMod, user, name) {
  $("#signupCard").innerHTML = `
    <h2>Check your email</h2>
    <p class="sub">
      We sent a verification link to <strong>${user.email}</strong>. Click it,
      then come back here.
    </p>
    <button type="button" id="checkVerified" style="width:100%;">I've verified — continue</button>
    <p class="field-error" id="signupError" style="text-align:center;"></p>`;

  $("#checkVerified").addEventListener("click", async () => {
    const btn = $("#checkVerified");
    btn.disabled = true;
    btn.textContent = "Checking…";
    try {
      await finishWithUser(auth, authMod, user, name);
    } finally {
      btn.disabled = false;
      btn.textContent = "I've verified — continue";
    }
  });
}

(async function boot() {
  let auth, authMod;
  try {
    ({ auth, authMod } = await loadFirebase());
  } catch (err) {
    setError(err.message ?? "Couldn't load sign-in. Try again shortly.");
    $("#googleBtn").disabled = true;
    $("#emailSubmit").disabled = true;
    return;
  }

  $("#googleBtn").addEventListener("click", async () => {
    setError("");
    try {
      const provider = new authMod.GoogleAuthProvider();
      const cred = await authMod.signInWithPopup(auth, provider);
      await finishWithUser(auth, authMod, cred.user, cred.user.displayName ?? "");
    } catch (err) {
      setError(err.message ?? "Google sign-in failed.");
    }
  });

  $("#toggleSignin").addEventListener("click", (e) => {
    e.preventDefault();
    mode = mode === "signup" ? "signin" : "signup";
    $("#emailSubmit").textContent = mode === "signup" ? "Sign up" : "Sign in";
    $("#toggleSignin").textContent = mode === "signup" ? "Sign in instead" : "Sign up instead";
    $('label:has(input[name="name"])').style.display = mode === "signup" ? "" : "none";
  });

  $("#emailForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    setError("");
    const form = new FormData(e.target);
    const name = form.get("name")?.trim() ?? "";
    const email = form.get("email").trim();
    const password = form.get("password");
    const btn = $("#emailSubmit");
    btn.disabled = true;

    try {
      let cred;
      if (mode === "signup") {
        cred = await authMod.createUserWithEmailAndPassword(auth, email, password);
        if (name) await authMod.updateProfile(cred.user, { displayName: name });
        await authMod.sendEmailVerification(cred.user);
      } else {
        cred = await authMod.signInWithEmailAndPassword(auth, email, password);
      }
      await finishWithUser(auth, authMod, cred.user, name);
    } catch (err) {
      setError(humanizeFirebaseError(err));
    } finally {
      btn.disabled = false;
    }
  });
})();

function humanizeFirebaseError(err) {
  const code = err?.code ?? "";
  if (code.includes("email-already-in-use")) return "That email already has an account — sign in instead.";
  if (code.includes("weak-password")) return "Password must be at least 8 characters.";
  if (code.includes("wrong-password") || code.includes("invalid-credential")) return "Wrong email or password.";
  if (code.includes("user-not-found")) return "No account with that email — sign up instead.";
  if (code.includes("popup-closed-by-user")) return "";
  return err?.message ?? "Something went wrong.";
}
