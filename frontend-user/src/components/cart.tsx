// Cart.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import CartItem from "./cartItem";
import Toast from "./Toast";
import { validateCoupon } from "../services/couponService";
import type { CouponValidationResult } from "../services/couponService";
import axiosInstance from "../api/axiosConfig";
import { useAuth } from "../hooks/useAuth";
import {
  FaShoppingCart,
  FaTag,
  FaCheck,
  FaTimes,
  FaArrowLeft,
  FaArrowRight,
  FaShoppingBag,
  FaPercent,
  FaGift,
} from "react-icons/fa";

export interface CartItemProps {
  id: string;
  user_id: string;
  variant_id: string;
  added_at: string;
  quantity: number;
}

export default function Cart() {
  const navigate = useNavigate();
  const [cartItems, setCartItems] = useState<CartItemProps[]>([]);
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState<CouponValidationResult | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [cartTotal, setCartTotal] = useState<number>(0);
  const [discount, setDiscount] = useState<number>(0);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({
    message: "",
    visible: false,
  });

  const user = useAuth();
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    if (user) {
      setUserId(user.id);
    }
  }, [user]);

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) {
      setCouponResult({
        valid: false,
        message: "Please enter a coupon code",
        discount: 0,
        finalTotal: cartTotal
      });
      return;
    }

    setIsApplying(true);
    try {
      const result = await validateCoupon(couponCode, cartTotal);
      setCouponResult(result);
      if (result.valid) {
        setAppliedCoupon(couponCode);
        setDiscount(result.discount);
      }
    } catch (error) {
      setCouponResult({
        valid: false,
        message: "Error validating coupon. Please try again.",
        discount: 0,
        finalTotal: cartTotal
      });
    } finally {
      setIsApplying(false);
    }
  };

  const handleRemoveCoupon = () => {
    setCouponCode("");
    setCouponResult(null);
    setAppliedCoupon(null);
    setDiscount(0);
  };

  async function fetchCartItems() {
    if (!userId) return;
    const res = await axiosInstance.get(`http://localhost:8080/api/cart?userId=${userId}`);
    const data = res.data;

    setCartItems(data);
  }
  useEffect(() => {
    fetchCartItems();
  }, [userId]);

  useEffect(() => {
    // Calculate cart total
    const calcTotal = async () => {
      let total = 0;
      for (const item of cartItems) {
        try {
          const variantRes = await axiosInstance.get(`http://localhost:8080/api/variant?id=${item.variant_id}`);
          const variantData = variantRes.data;
          total += variantData.price * item.quantity;
        } catch (error) {
          console.error("Error fetching variant for cart total calculation:", error);
        }
      }
      setCartTotal(total);
    };
    const calcDisc = async () => {
      if (!appliedCoupon) return;
      try {
        const result = await validateCoupon(couponCode, cartTotal);
        setCouponResult(result);
        if (result.valid) {
          setAppliedCoupon(couponCode);
          setDiscount(result.discount);
        }
      } catch (error) {
        setCouponResult({
          valid: false,
          message: "Error validating coupon. Please try again.",
          discount: 0,
          finalTotal: cartTotal
        });
      } finally {
        setIsApplying(false);
      }
    };
    calcDisc();
    calcTotal();
  }, [cartItems]);

  async function handleCheckout() {
    if (isCheckingOut) return; // Prevent double submission
    
    setIsCheckingOut(true);
    try {
      
      // Get coupon ID if a coupon is applied
      let couponId = null;
      if (appliedCoupon) {
        
        try {
          const couponResponse = await axiosInstance.get(`http://localhost:8080/api/coupon?code=${appliedCoupon}`);
          couponId = couponResponse.data.id;
        } catch (error) {
          console.error("Error fetching coupon ID:", error);
        }
      }

      // 1. Create transaction
      const createTransactionResponse = await axiosInstance.post("http://localhost:8080/api/transaction", {
        user_id: userId,
        total_amount: cartTotal - discount,
        coupon_id: couponId,
        payment_status: "PENDING"
        // Backend will generate transaction_id and transaction_date
      });

      if (createTransactionResponse.status === 200) {
        const transactionId = createTransactionResponse.data;

        // 2. Create order items
        const orderItemsPromises = cartItems.map(async (item) => {
          const variantRes = await axiosInstance.get(`http://localhost:8080/api/variant?id=${item.variant_id}`);
          const variantData = variantRes.data;
          // console.log(transactionId,item.variant_id, "hello yogesh")
          return axiosInstance.post("http://localhost:8080/api/orders", {
            user_id: userId,
            variant_id: item.variant_id,
            quantity: item.quantity,
            price: variantData.price,
            transaction_id: transactionId
            // Backend will generate order_item_id and order_date
          });

        });
        
        await Promise.all(orderItemsPromises);
        
        // 3. Clear cart items one by one
        const clearCartPromises = cartItems.map(item => 
          axiosInstance.delete(`http://localhost:8080/api/cart?id=${item.id}`)
        );
        await Promise.all(clearCartPromises);
        await axiosInstance.post("http://localhost:8080/api/checkout", {
            userId: userId,
            name: user?.name,
            email: user?.email,
            totalAmount: cartTotal - discount,
            discount: discount,
            couponCode: appliedCoupon,
            items: cartItems
      });
        
        // 4. Update local state
        setCartItems([]);
        setCouponCode("");
        setCouponResult(null);
        setAppliedCoupon(null);
        setDiscount(0);
        setCartTotal(0);

        // Show success toast
        setToast({ message: "Order placed successfully! 🎉", visible: true });
        
        // Navigate after a short delay
        setTimeout(() => {
          navigate("/transactions");
        }, 2000);
      } else {
        throw new Error("Failed to create transaction");
      }
    } catch (error) {
      console.error("Checkout error:", error);
      setToast({ message: "Checkout failed. Please try again.", visible: true });
    } finally {
      setIsCheckingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 pt-20 pb-16">
      {/* Toast Notification */}
      {toast.visible && (
        <Toast
          message={toast.message}
          onClose={() => setToast({ message: "", visible: false })}
        />
      )}
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
              <FaShoppingCart className="text-white text-2xl" />
            </div>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Shopping Cart
              </h1>
              <p className="text-gray-600 mt-1">
                {cartItems.length} {cartItems.length === 1 ? 'item' : 'items'} in your cart
              </p>
            </div>
          </div>
        </div>

        {cartItems.length === 0 ? (
          /* Empty Cart State */
          <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
            <div className="w-32 h-32 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center mx-auto mb-6">
              <FaShoppingBag className="text-gray-400 text-5xl" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">Your cart is empty</h2>
            <p className="text-gray-600 mb-8">
              Looks like you haven't added any courses yet. Start exploring!
            </p>
            <button
              onClick={() => navigate("/products")}
              className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300"
            >
              Browse Courses
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Cart Items - Left Side */}
            <div className="lg:col-span-2 space-y-4">
              {cartItems.map((item) => (
                <CartItem key={item.id} item={item} setCartItems={setCartItems} />
              ))}
            </div>

            {/* Order Summary - Right Side */}
            <div className="lg:col-span-1">
              <div className="sticky top-24 space-y-4">
                {/* Coupon Section */}
                <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-200">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-pink-500 rounded-lg flex items-center justify-center">
                      <FaTag className="text-white" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Apply Coupon</h3>
                  </div>

                  {!appliedCoupon ? (
                    <div className="space-y-3">
                      <div className="relative">
                        <FaGift className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                        <input
                          type="text"
                          value={couponCode}
                          onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                          placeholder="Enter coupon code"
                          className="w-full pl-10 pr-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                          disabled={isApplying}
                        />
                      </div>
                      <button
                        onClick={handleApplyCoupon}
                        disabled={isApplying}
                        className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-xl hover:shadow-lg transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none transition-all duration-300 flex items-center justify-center gap-2"
                      >
                        {isApplying ? (
                          <>
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                            Applying...
                          </>
                        ) : (
                          <>
                            <FaCheck />
                            Apply Coupon
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                            <FaCheck className="text-white" />
                          </div>
                          <div>
                            <p className="text-sm text-gray-600">Coupon Applied</p>
                            <p className="font-bold text-green-800">"{appliedCoupon}"</p>
                          </div>
                        </div>
                        <button
                          onClick={handleRemoveCoupon}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove coupon"
                        >
                          <FaTimes size={18} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Coupon Status Message */}
                  {couponResult && !appliedCoupon && (
                    <div className={`mt-4 p-4 rounded-xl border-2 ${
                      couponResult.valid
                        ? "bg-green-50 border-green-300"
                        : "bg-red-50 border-red-300"
                    }`}>
                      <div className="flex items-start gap-3">
                        {couponResult.valid ? (
                          <FaCheck className="text-green-600 mt-1" />
                        ) : (
                          <FaTimes className="text-red-600 mt-1" />
                        )}
                        <p className={`font-medium ${
                          couponResult.valid ? "text-green-800" : "text-red-800"
                        }`}>
                          {couponResult.message}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Price Summary */}
                <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-200">
                  <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <FaPercent className="text-blue-600" />
                    Order Summary
                  </h3>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center py-2">
                      <span className="text-gray-600">Subtotal</span>
                      <span className="font-semibold text-gray-900">₹{cartTotal.toFixed(2)}</span>
                    </div>

                    {discount > 0 && (
                      <div>
                        <div className="flex justify-between items-center py-2 text-green-600">
                          <span className="font-medium flex items-center gap-2">
                            <FaTag /> Coupon Discount
                          </span>
                          <span className="font-bold">- ₹{discount.toFixed(2)}</span>
                        </div>
                        <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-3 border border-green-200">
                          <p className="text-sm text-green-700 font-semibold text-center">
                            🎉 You saved ₹{discount.toFixed(2)}!
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="border-t-2 border-gray-200 pt-3 mt-3">
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-bold text-gray-900">Total Amount</span>
                        <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                          ₹{(cartTotal - discount).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div  className="mt-6 space-y-3">
                    <button
                      onClick={handleCheckout}
                      disabled={isCheckingOut}
                      className={`w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-xl shadow-lg transition-all duration-300 flex items-center justify-center gap-2 ${
                        isCheckingOut 
                          ? 'opacity-75 cursor-not-allowed' 
                          : 'hover:shadow-xl transform hover:scale-105'
                      }`}
                    >
                      {isCheckingOut ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-3 border-white border-t-transparent"></div>
                          Processing Order...
                        </>
                      ) : (
                        <>
                          Proceed to Checkout
                          <FaArrowRight />
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => navigate("/products")}
                      className="w-full py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
                    >
                      <FaArrowLeft />
                      Continue Shopping
                    </button>
                  </div>
                </div>

                {/* Security Badge */}
                <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4 border border-blue-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <FaCheck className="text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Secure Checkout</p>
                      <p className="text-xs text-gray-600">Your data is protected</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
