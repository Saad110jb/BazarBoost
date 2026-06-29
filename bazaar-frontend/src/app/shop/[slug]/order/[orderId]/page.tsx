import React from "react";
import OrderTrackingClient from "./OrderTrackingClient";

export const dynamic = 'force-dynamic';

export default async function OrderTrackingPage() {
  return <OrderTrackingClient />;
}
