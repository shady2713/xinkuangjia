import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from '@/App.vue';
import { registerPermissionDirective } from '@/directives/permission';
import { router, syncSessionRoutes } from '@/router';
import '@/styles/index.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
syncSessionRoutes(pinia);
app.use(router);
app.use(ElementPlus);
registerPermissionDirective(app);
app.mount('#app');
