"use client";

export default function ConnectBrokerButton() {

  const connectBroker =
    () => {

      window.location.href =
        "/api/upstox/login";
    };

  return (
    <button
      onClick={
        connectBroker
      }
      className="bg-blue-600 hover:bg-blue-500 transition-all px-6 py-3 rounded-2xl font-semibold text-white"
    >

      Connect Upstox

    </button>
  );
}