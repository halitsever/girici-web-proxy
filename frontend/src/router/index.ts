import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/Home/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/Settings/SettingsView.vue')
    },
    {
      path: '/setup',
      name: 'setup',
      component: () => import('../views/Setup/SetupView.vue')
    }
  ]
})

export default router
