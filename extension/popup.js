fetch("http://127.0.0.1:4318/health")
  .then(() => {
    document.getElementById("dot").className = "dot";
    document.getElementById("statusText").textContent = "后端已连接";
  })
  .catch(() => {
    document.getElementById("dot").className = "dot off";
    document.getElementById("statusText").textContent = "后端未启动";
  });
