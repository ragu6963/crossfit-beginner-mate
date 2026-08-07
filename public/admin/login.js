const form = document.getElementById("login-form");
const errorText = document.getElementById("error-text");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorText.classList.add("hidden");

  const password = document.getElementById("password").value;

  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      window.location.href = "/admin/index.html";
      return;
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const minutes = retryAfter ? Math.ceil(Number(retryAfter) / 60) : 15;
      errorText.textContent = `로그인 시도가 너무 많습니다. ${minutes}분 후 다시 시도하세요.`;
    } else {
      errorText.textContent = "비밀번호가 올바르지 않습니다.";
    }
    errorText.classList.remove("hidden");
  } catch {
    errorText.textContent = "로그인 요청에 실패했습니다. 잠시 후 다시 시도해주세요.";
    errorText.classList.remove("hidden");
  }
});
