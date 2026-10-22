(function () {
  var THEMES = ["paper", "sepia", "white", "eye", "douchi", "night", "dark", "amoled"];
  var DARK = ["night", "dark", "amoled"];

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeKind = DARK.indexOf(theme) === -1 ? "light" : "dark";
  }

  try {
    var saved = localStorage.getItem("pagenest.ui.v2");
    var legacy = localStorage.getItem("pagenest.ui.v1");
    var value = saved ? JSON.parse(saved) : legacy ? JSON.parse(legacy) : null;
    var theme = value && value.state ? value.state.ui?.theme : value?.ui?.theme;
    apply(THEMES.indexOf(theme) === -1 ? "paper" : theme);
  } catch {
    apply("paper");
  }
})();
