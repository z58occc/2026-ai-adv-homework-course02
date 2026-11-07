const { createApp, ref, computed, watch, onMounted } = Vue;

createApp({
  setup() {
    if (!Auth.requireAuth()) return {};

    const loading = ref(true);
    const submitting = ref(false);
    const cartItems = ref([]);
    const form = ref({
      recipientName: '',
      recipientEmail: '',
      recipientAddress: '',
      shippingMethod: 'home_delivery',
      isUrgent: false
    });
    const errors = ref({});

    // 運費一律由後端 Shipping 模組試算，前端不自行計算
    const quote = ref(null);
    const quoting = ref(false);
    let quoteSeq = 0;
    let quoteTimer = null;

    const cartTotal = computed(function () {
      return cartItems.value.reduce(function (sum, item) {
        return sum + item.product.price * item.quantity;
      }, 0);
    });

    const isCvsPickup = computed(function () {
      return form.value.shippingMethod === 'cvs_pickup';
    });

    async function fetchQuote(seq) {
      try {
        const res = await apiFetch('/api/shipping/quote', {
          method: 'POST',
          body: JSON.stringify({
            subtotal: cartTotal.value,
            shippingMethod: form.value.shippingMethod,
            isUrgent: form.value.isUrgent,
            recipientAddress: form.value.recipientAddress
          })
        });
        if (seq !== quoteSeq) return; // 已有較新的試算請求
        quote.value = res.data;
      } catch (err) {
        if (seq !== quoteSeq) return;
        quote.value = null;
        Notification.show(err?.data?.message || '運費試算失敗', 'error');
      } finally {
        if (seq === quoteSeq) quoting.value = false;
      }
    }

    // 試算期間停用送出鈕，避免以過期的金額下單
    function scheduleQuote(delay) {
      const seq = ++quoteSeq;
      clearTimeout(quoteTimer);
      quoting.value = true;
      quoteTimer = setTimeout(function () { fetchQuote(seq); }, delay);
    }

    // 地址影響偏遠地區判定：輸入停頓後再試算；配送選項切換則立即試算
    watch(function () { return form.value.recipientAddress; }, function () { scheduleQuote(400); });
    watch(
      function () { return [form.value.shippingMethod, form.value.isUrgent]; },
      function () { scheduleQuote(0); }
    );

    function validate() {
      errors.value = {};
      if (!form.value.recipientName.trim()) errors.value.recipientName = '請輸入收件人姓名';
      if (!form.value.recipientEmail.trim()) {
        errors.value.recipientEmail = '請輸入 Email';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.recipientEmail)) {
        errors.value.recipientEmail = 'Email 格式不正確';
      }
      if (!form.value.recipientAddress.trim()) {
        errors.value.recipientAddress = isCvsPickup.value ? '請輸入取貨門市地址' : '請輸入收件地址';
      }
      return Object.keys(errors.value).length === 0;
    }

    async function submitOrder() {
      if (!validate() || submitting.value || quoting.value) return;
      submitting.value = true;
      try {
        const res = await apiFetch('/api/orders', {
          method: 'POST',
          body: JSON.stringify(form.value)
        });
        Notification.show('訂單已建立，正在前往付款...', 'success');
        window.location.href = '/ecpay/payment/' + res.data.id;
      } catch (err) {
        Notification.show(err?.data?.message || '訂單建立失敗', 'error');
      } finally {
        submitting.value = false;
      }
    }

    onMounted(async function () {
      try {
        const res = await apiFetch('/api/cart');
        cartItems.value = res.data.items;
        if (cartItems.value.length === 0) {
          window.location.href = '/cart';
          return;
        }
      } catch (e) {
        window.location.href = '/cart';
        return;
      }
      loading.value = false;
      scheduleQuote(0);
    });

    return {
      loading, submitting, cartItems, form, errors, cartTotal,
      isCvsPickup, quote, quoting, submitOrder
    };
  }
}).mount('#app');
