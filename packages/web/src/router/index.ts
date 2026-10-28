import { createRouter, createWebHistory } from "vue-router";
import { getAuthState } from "@/lib/auth";

export const LOGIN_PATH = "/_g/login";
export const SETUP_PATH = "/_g/setup";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "browse", component: () => import("@/views/Browse/BrowseView.vue") },
    { path: "/settings", name: "settings", component: () => import("@/views/Settings/SettingsView.vue") },
    {
      path: "/account",
      name: "account",
      component: () => import("@/views/Account/AccountView.vue"),
      meta: { auth: true },
    },
    {
      path: SETUP_PATH,
      name: "setup",
      component: () => import("@/views/Setup/SetupView.vue"),
      meta: { chromeless: true },
    },
    {
      path: LOGIN_PATH,
      name: "login",
      component: () => import("@/views/Login/LoginView.vue"),
      meta: { chromeless: true },
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach(async (to) => {
  let state;
  try {
    state = await getAuthState();
  } catch {
    // Let the view render; the server gates the data path regardless of the client guard.
    return true;
  }
  if (state.setup) return to.path === SETUP_PATH ? true : SETUP_PATH;
  if (to.path === SETUP_PATH) return "/";
  if (to.path === LOGIN_PATH) return state.authed ? "/" : true;
  const needsAuth = to.meta.auth === true || !state.public;
  if (!state.authed && needsAuth) {
    return to.fullPath === "/" ? { path: LOGIN_PATH } : { path: LOGIN_PATH, query: { next: to.fullPath } };
  }
  return true;
});

export default router;
