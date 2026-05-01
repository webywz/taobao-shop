import { createRouter, createWebHistory } from 'vue-router'
import { getStoredAdminToken } from '../lib/api'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/admin/codes'
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue')
    },
    {
      path: '/admin/codes',
      name: 'admin-codes',
      component: () => import('../views/AdminCodesView.vue')
    },
    {
      path: '/extract',
      name: 'extract',
      component: () => import('../views/ExtractView.vue')
    },
    {
      path: '/tasks',
      name: 'tasks',
      component: () => import('../views/TasksView.vue')
    },
    {
      path: '/tasks/:taskId',
      name: 'task-detail',
      component: () => import('../views/TaskDetailView.vue')
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/admin/codes'
    }
  ]
})

router.beforeEach((to) => {
  if (to.path === '/login') {
    return true
  }
  if (!getStoredAdminToken()) {
    return '/login'
  }
  return true
})

export default router
