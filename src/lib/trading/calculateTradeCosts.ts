export function calculateTradeCosts(
  entryPrice: number,

  exitPrice: number,

  quantity: number
) {
  /*
    Trade values
  */

  const buyValue =
    entryPrice * quantity;

  const sellValue =
    exitPrice * quantity;

  const turnover =
    buyValue + sellValue;

  /*
    Brokerage
  */

  const brokerage =
    40;

  /*
    STT
  */

  const stt =
    sellValue * 0.00025;

  /*
    Exchange charges
  */

  const exchangeCharges =
    turnover * 0.0000345;

  /*
    GST
  */

  const gst =
    (brokerage +
      exchangeCharges) *
    0.18;

  /*
    SEBI charges
  */

  const sebiCharges =
    turnover * 0.000001;

  /*
    Stamp duty
  */

  const stampDuty =
    buyValue * 0.00003;

  /*
    Total costs
  */

  const totalCharges =
    brokerage +
    stt +
    exchangeCharges +
    gst +
    sebiCharges +
    stampDuty;

  return {
    brokerage:
      Number(
        brokerage.toFixed(2)
      ),

    stt: Number(
      stt.toFixed(2)
    ),

    exchangeCharges:
      Number(
        exchangeCharges.toFixed(
          2
        )
      ),

    gst: Number(
      gst.toFixed(2)
    ),

    sebiCharges:
      Number(
        sebiCharges.toFixed(
          2
        )
      ),

    stampDuty:
      Number(
        stampDuty.toFixed(2)
      ),

    totalCharges:
      Number(
        totalCharges.toFixed(
          2
        )
      ),
  };
}