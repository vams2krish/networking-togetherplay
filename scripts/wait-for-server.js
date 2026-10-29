const url = process.env.BASE_URL || "http://localhost:3000";
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    if ((await fetch(`${url}/healthz`)).ok) process.exit(0);
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.error("Server did not become healthy");
process.exit(1);
