const status = document.querySelector("#status");
const connected = document.querySelector("#connected");
const form = document.querySelector("#login");
const baseInput = document.querySelector("#base");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const error = document.querySelector("#error");
const logout = document.querySelector("#logout");
const submit = document.querySelector("#submit");

function showSignedIn(email, base) {
  status.textContent = email ? `Signed in as ${email}` : "Signed in";
  connected.textContent = base ? `Connected to ${base}` : "";
  connected.hidden = !base;
  form.hidden = true;
  logout.hidden = false;
  passwordInput.value = "";
}

function showSignedOut(base, email) {
  status.textContent = "Sign in with the same account as the dashboard.";
  connected.hidden = true;
  connected.textContent = "";
  form.hidden = false;
  logout.hidden = true;
  if (base) baseInput.value = base;
  if (email) emailInput.value = email;
}

chrome.runtime.sendMessage({ type: "get-state" }, (state) => {
  if (chrome.runtime.lastError || !state) {
    showSignedOut();
    return;
  }
  if (state.signedIn) showSignedIn(state.email, state.baseUrl);
  else showSignedOut(state.baseUrl, state.email);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  error.textContent = "";
  submit.disabled = true;
  chrome.runtime.sendMessage(
    {
      type: "login",
      baseUrl: baseInput.value,
      email: emailInput.value,
      password: passwordInput.value,
    },
    (response) => {
      submit.disabled = false;
      if (chrome.runtime.lastError || !response?.ok) {
        error.textContent = response?.error || chrome.runtime.lastError?.message || "Could not sign in.";
        return;
      }
      showSignedIn(response.email, baseInput.value);
    },
  );
});

logout.addEventListener("click", () => {
  logout.disabled = true;
  chrome.runtime.sendMessage({ type: "logout" }, () => {
    logout.disabled = false;
    showSignedOut(baseInput.value, emailInput.value);
  });
});
