const { createApp, ref, computed, watch, onMounted } = Vue;

createApp({
  setup() {
    const items = ref([]);
    const loading = ref(true);
    const confirmVisible = ref(false);
    const deleteItemId = ref('');
    const fallbackImage = 'https://images.unsplash.com/photo-1490750967868-88aa4f44baee?w=300';

    const total = computed(function () {
      return items.value.reduce(function (sum, item) {
        return sum + item.product.price * item.quantity;
      }, 0);
    });

    // 購物車頁以預設的宅配試算運費；配送方式等選項於結帳頁再選
    const quote = ref(null);
    let quoteSeq = 0;

    async function loadQuote() {
      const seq = ++quoteSeq;
      if (items.value.length === 0) {
        quote.value = null;
        return;
      }
      try {
        const res = await apiFetch('/api/shipping/quote', {
          method: 'POST',
          body: JSON.stringify({ subtotal: total.value })
        });
        if (seq === quoteSeq) quote.value = res.data;
      } catch (e) {
        if (seq === quoteSeq) quote.value = null;
      }
    }

    watch(total, loadQuote);

    async function loadCart() {
      loading.value = true;
      try {
        const res = await apiFetch('/api/cart');
        items.value = res.data.items;
      } catch (e) {
        Notification.show('載入購物車失敗', 'error');
      } finally {
        loading.value = false;
      }
    }

    async function updateQuantity(itemId, qty) {
      if (qty < 1) return;
      try {
        await apiFetch('/api/cart/' + itemId, {
          method: 'PATCH',
          body: JSON.stringify({ quantity: qty })
        });
        var item = items.value.find(function (i) { return i.id === itemId; });
        if (item) item.quantity = qty;
      } catch (e) {
        Notification.show('更新數量失敗', 'error');
      }
    }

    function confirmDelete(itemId) {
      deleteItemId.value = itemId;
      confirmVisible.value = true;
    }

    async function handleDelete() {
      confirmVisible.value = false;
      try {
        await apiFetch('/api/cart/' + deleteItemId.value, { method: 'DELETE' });
        items.value = items.value.filter(function (i) { return i.id !== deleteItemId.value; });
        Notification.show('已從購物車移除', 'success');
      } catch (e) {
        Notification.show('移除失敗', 'error');
      }
    }

    function goCheckout() {
      if (!Auth.isLoggedIn()) {
        window.location.href = '/login?redirect=/checkout';
        return;
      }
      window.location.href = '/checkout';
    }

    onMounted(function () {
      loadCart();
    });

    return {
      items, loading, total, quote, confirmVisible, fallbackImage,
      updateQuantity, confirmDelete, handleDelete, goCheckout
    };
  }
}).mount('#app');
