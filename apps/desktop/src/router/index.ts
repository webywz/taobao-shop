import { createRouter, createWebHistory } from 'vue-router'
import { clearStoredLicenseToken, getCurrentLicense, getStoredLicenseToken } from '../lib/api'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/activate'
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
      path: '/activate',
      name: 'activate',
      component: () => import('../views/ActivateView.vue')
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/activate'
    }
  ]
})

router.beforeEach(async (to) => {
  const hasLicense = Boolean(getStoredLicenseToken())

  if (to.path.startsWith('/activate')) {
    if (!hasLicense) {
      return true
    }

    try {
      await getCurrentLicense()
    } catch {
      clearStoredLicenseToken()
      return true
    }

    return '/extract'
  }

  if (!hasLicense) {
    return '/activate'
  }

  try {
    await getCurrentLicense()
  } catch {
    clearStoredLicenseToken()
    return '/activate'
  }

  return true
})

export default router
