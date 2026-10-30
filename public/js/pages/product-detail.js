const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    const productId = document.getElementById('app').dataset.productId;
    const product = ref(null);
    const related = ref([]);
    const loading = ref(true);
    const notFound = ref(false);
    const quantity = ref(1);
    const adding = ref(false);

    const fallbackImage = 'https://images.unsplash.com/photo-1490750967868-88aa4f44baee?w=800';

    function decrease() {
      if (quantity.value > 1) quantity.value--;
    }

    function increase() {
      if (product.value && quantity.value < product.value.stock) quantity.value++;
    }

    function goToProduct(id) {
      window.location.href = '/products/' + id;
    }

    async function postToCart(id, qty) {
      await apiFetch('/api/cart', {
        method: 'POST',
        body: JSON.stringify({ productId: id, quantity: qty })
      });
      Notification.show('已加入購物車', 'success');
      var badge = document.getElementById('cart-badge');
      if (badge) {
        var count = parseInt(badge.textContent || '0') + 1;
        badge.textContent = count;
        badge.style.display = 'flex';
      }
    }

    async function addToCart() {
      if (!product.value || adding.value) return;
      adding.value = true;
      try {
        await postToCart(product.value.id, quantity.value);
      } catch (e) {
        Notification.show('加入購物車失敗', 'error');
      } finally {
        adding.value = false;
      }
    }

    async function addRelated(item) {
      try {
        await postToCart(item.id, 1);
      } catch (e) {
        Notification.show('加入購物車失敗', 'error');
      }
    }

    async function loadRelated() {
      try {
        const res = await apiFetch('/api/products?page=1&limit=4');
        related.value = res.data.products
          .filter(function (p) { return p.id !== productId; })
          .slice(0, 3);
      } catch (e) {
        related.value = [];
      }
    }

    onMounted(async function () {
      try {
        const res = await apiFetch('/api/products/' + productId);
        product.value = res.data;
        loadRelated();
      } catch (e) {
        notFound.value = true;
      } finally {
        loading.value = false;
      }
    });

    return {
      product, related, loading, notFound, quantity, adding, fallbackImage,
      decrease, increase, goToProduct, addToCart, addRelated
    };
  }
}).mount('#app');
