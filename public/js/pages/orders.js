const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    if (!Auth.requireAuth()) return {};

    const orders = ref([]);
    const loading = ref(true);

    const statusMap = {
      pending: { label: '待付款', cls: 'bg-saffron-bg text-saffron-ink' },
      paid: { label: '已付款', cls: 'bg-fern-bg text-fern' },
      failed: { label: '付款失敗', cls: 'bg-berry-bg text-berry' },
    };

    onMounted(async function () {
      try {
        const res = await apiFetch('/api/orders');
        orders.value = res.data.orders;
      } catch (e) {
        orders.value = [];
      } finally {
        loading.value = false;
      }
    });

    return { orders, loading, statusMap };
  }
}).mount('#app');
