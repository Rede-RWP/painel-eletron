/* eslint-disable no-undef */
chrome.action.onClicked.addListener(function (tab) {
  chrome.tabs.create({ url: "https://web.whatsapp.com/" });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchImage") {
    // console.log(
    //   "Background script: Fetching image through proxy for URL:",
    //   request.url
    // );
    fetchImageProxy(request.url)
      .then((data) => {
        // console.log(
        //   "Background script: Successfully fetched image, size:",
        //   data.size
        // );
        sendResponse({ data });
      })
      .catch((error) => {
        console.error("Error fetching image:", error);
        sendResponse({ error: error.message });
      });
    return true; // Indicate that the response will be asynchronous
  }
});

async function fetchImageProxy(url) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "image/* video/* text/* audio/*",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const contentType = response.headers.get("Content-Type");
    const contentLength = response.headers.get("Content-Length");
    const contentDisposition = response.headers.get("Content-Disposition");

    const name = contentDisposition
      ? contentDisposition.match(/((?<=filename=")(.*)(?="))/)
      : null;

    // Convert the response to base64
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let base64 = "";

    for (let i = 0; i < uint8Array.length; i++) {
      base64 += String.fromCharCode(uint8Array[i]);
    }

    const data = btoa(base64);

    return {
      data,
      mime: contentType,
      name: name ? name[0] : null,
      size: contentLength,
    };
  } catch (error) {
    console.error("Error fetching image through proxy:", error);
    throw error;
  }
}
