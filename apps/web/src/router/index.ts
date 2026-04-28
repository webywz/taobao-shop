import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/HomeView.vue')
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
      path: '/help',
      name: 'help',
      component: () => import('../views/HelpView.vue')
    },
    {
      path: '/activate',
      name: 'activate',
      component: () => import('../views/ActivateView.vue')
    },
    {
      path: '/install-plugin',
      name: 'install-plugin',
      component: () => import('../views/InstallPluginView.vue')
    }
  ]
})

export default router