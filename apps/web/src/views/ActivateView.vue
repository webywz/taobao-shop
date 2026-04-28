<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { redeemLicense } from '../lib/api'
import { bindCurrentLicenseToPlugin, pingPlugin } from '../lib/plugin-bridge'

const router = useRouter()
const activationCode = ref('')
const loading = ref(false)
const message = ref<string | null>(null)

async function handleSubmit() {
  if (!activationCode.value.trim()) {
    ElMessage.warning('请输入激活码')
    return
  }

  loading.value = true
  message.value = null

  try {
    const license = await redeemLicense(activationCode.value.trim().toUpperCase())
    try {
      const ping = await pingPlugin()

      if (ping.installed) {
        const bindResult = await bindCurrentLicenseToPlugin()
        message.value = bindResult.success
            ? `激活成功并完成插件绑定，有效期 ${license.durationDays} 天`
            : `激活成功，有效期 ${license.durationDays} 天，请手动检查插件绑定`
      } else {
        message.value = `激活成功，有效期 ${license.durationDays} 天，请先安装插件`
      }
    } catch {
      message.value = `激活成功，有效期 ${license.durationDays} 天，请确认插件已安装`
    }

    ElMessage.success('激活成功')
    setTimeout(() => {
      router.push("/extract")
    }, 1500)
  } catch (error) {
    message.value = error instanceof Error ? error.message : "激活失败"
    ElMessage.error(message.value)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto py-12">
    <div class="bg-white shadow sm:rounded-lg">
      <div class="px-4 py-5 sm:p-6">
        <h3 class="text-lg leading-6 font-medium text-gray-900">
          🔑 激活授权
        </h3>
        <div class="mt-2 max-w-xl text-sm text-gray-500">
          <p>输入你的卡密以激活本设备。激活后可获得相应天数的商品图片提取额度。</p>
        </div>
        <form class="mt-5 sm:flex sm:items-center" @submit.prevent="handleSubmit">
          <div class="w-full sm:max-w-xs">
            <label for="activation-code" class="sr-only">激活码</label>
            <input
              type="text"
              name="activation-code"
              id="activation-code"
              class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md py-2 px-3 border"
              placeholder="ABCD-EFGH-JKLM-NPQR"
              v-model="activationCode"
            />
          </div>
          <button
            type="submit"
            :disabled="loading"
            class="mt-3 w-full inline-flex items-center justify-center px-4 py-2 border border-transparent shadow-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            {{ loading ? '激活中...' : '激活并继续' }}
          </button>
          <button
            type="button"
            @click="activationCode = ''"
            class="mt-3 w-full inline-flex items-center justify-center px-4 py-2 border border-gray-300 shadow-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            清空输入
          </button>
        </form>
        
        <div v-if="message" class="mt-4 p-4 rounded-md bg-blue-50 text-blue-700 text-sm">
          {{ message }}
        </div>
      </div>
    </div>
  </div>
</template>