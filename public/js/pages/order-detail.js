const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    if (!Auth.requireAuth()) return {};

    const el = document.getElementById('app');
    const orderId = el.dataset.orderId;
    const paymentResult = ref(el.dataset.paymentResult || null);

    const order = ref(null);
    const loading = ref(true);
    const paying = ref(false);

    const statusMap = {
      pending: { label: '待付款', cls: 'bg-saffron-bg text-saffron-ink' },
      paid: { label: '已付款', cls: 'bg-fern-bg text-fern' },
      failed: { label: '付款失敗', cls: 'bg-berry-bg text-berry' },
    };

    const shippingMethodLabels = {
      home_delivery: '宅配',
      cvs_pickup: '超商取貨',
    };

    const paymentMessages = {
      success: { text: '付款成功！感謝您的購買。', cls: 'bg-fern-bg text-fern' },
      failed: { text: '付款失敗，請重試。', cls: 'bg-berry-bg text-berry' },
      cancel: { text: '付款已取消。', cls: 'bg-saffron-bg text-saffron-ink' },
      pending: { text: '付款處理中，請點擊「查詢付款狀態」確認結果。', cls: 'bg-saffron-bg text-saffron-ink' },
    };

    async function checkPayment() {
      if (!order.value || paying.value) return;
      paying.value = true;
      try {
        const res = await apiFetch('/api/orders/' + order.value.id + '/check-payment', {
          method: 'POST'
        });
        order.value = res.data;
        if (res.data.status === 'paid') {
          paymentResult.value = 'success';
        } else {
          Notification.show(res.message || '尚未完成付款，請稍後再查詢', 'info');
        }
      } catch (e) {
        Notification.show(e?.data?.message || '查詢付款狀態失敗', 'error');
      } finally {
        paying.value = false;
      }
    }

    onMounted(async function () {
      try {
        const res = await apiFetch('/api/orders/' + orderId);
        order.value = res.data;

        if (paymentResult.value === 'pending' && order.value.status === 'pending') {
          await checkPayment();
        }
      } catch (e) {
        Notification.show('載入訂單失敗', 'error');
      } finally {
        loading.value = false;
      }
    });

    return { order, loading, paying, paymentResult, statusMap, shippingMethodLabels, paymentMessages, checkPayment };
  }
}).mount('#app');
