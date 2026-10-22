(function () {
  try {
    var saved = localStorage.getItem("pagenest.ui.v2");
    var legacy = localStorage.getItem("pagenest.ui.v1");
    var value = saved ? JSON.parse(saved) : legacy ? JSON.parse(legacy) : null;
    var theme = value && value.state ? value.state.ui?.theme : value?.ui?.theme;
    document.documentElement.dataset.theme = theme === "night" || theme === "eye" ? theme : "paper";
  } catch {
    document.documentElement.dataset.theme = "paper";
  }
})();
