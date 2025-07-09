const menuTrigger = document.getElementById("menu-toggle");
const drawerToggle = document.querySelector(
  'input[type=checkbox][data-md-toggle="drawer"]'
);
console.info({ menuTrigger, drawerToggle });
if (menuTrigger && drawerToggle) {
  menuTrigger.addEventListener("click", () => {
    drawerToggle.checked = !drawerToggle.checked;
  });
}
