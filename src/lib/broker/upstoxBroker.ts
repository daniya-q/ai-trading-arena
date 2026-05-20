import axios from "axios";

import {
  BrokerAdapter,
  BrokerOrder,
} from "./types";

export class UpstoxBroker
  implements BrokerAdapter
{
  private accessToken =
    process.env
      .UPSTOX_ACCESS_TOKEN || "";

  async placeOrder(
    order: BrokerOrder
  ) {

    try {

      /*
        IMPORTANT:
        instrument_token below
        is currently mocked.

        Later:
        we map symbols
        dynamically.
      */

      const instrumentMap:
        Record<
          string,
          string
        > = {
        NIFTY:
          "NSE_INDEX|Nifty 50",

        BANKNIFTY:
          "NSE_INDEX|Nifty Bank",

        SENSEX:
          "BSE_INDEX|SENSEX",

        FINNIFTY:
          "NSE_INDEX|Nifty Fin Service",
      };

      const instrumentToken =
        instrumentMap[
          order.symbol
        ];

      if (
        !instrumentToken
      ) {
        throw new Error(
          "Invalid instrument"
        );
      }

      const response =
        await axios.post(
          "https://api-hft.upstox.com/v2/order/place",

          {
            quantity:
              order.quantity,

            product:
              order.product,

            validity:
              order.validity,

            price: 0,

            tag: "AI_TRADER",

            instrument_token:
              instrumentToken,

            order_type:
              order.orderType,

            transaction_type:
              order.side,

            disclosed_quantity: 0,

            trigger_price: 0,

            is_amo: false,
          },

          {
            headers: {
              Authorization: `Bearer ${this.accessToken}`,

              "Content-Type":
                "application/json",
            },
          }
        );

      console.log(
        "UPSTOX ORDER SUCCESS:"
      );

      console.log(
        response.data
      );

      return response.data;

    } catch (error: any) {

      console.error(
        "Upstox Order Error:"
      );

      console.error(
        error?.response
          ?.data || error
      );

      throw error;
    }
  }

  async getPositions() {

    try {

      const response =
        await axios.get(
          "https://api.upstox.com/v2/portfolio/short-term-positions",

          {
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
            },
          }
        );

      return (
        response.data
          ?.data || []
      );

    } catch (error) {

      console.error(
        "Position Error:",
        error
      );

      return [];
    }
  }

  async getBalance() {

    try {

      const response =
        await axios.get(
          "https://api.upstox.com/v2/user/get-funds-and-margin",

          {
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
            },
          }
        );

      return response.data;

    } catch (error) {

      console.error(
        "Balance Error:",
        error
      );

      return null;
    }
  }
}