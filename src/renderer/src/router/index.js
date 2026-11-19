import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import DeviceView from '@/views/DeviceView.vue'
import SettingsView from '@/views/SettingsView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/device/:id', name: 'device', component: DeviceView, props: true },
    { path: '/settings', name: 'settings', component: SettingsView }
  ]
})
