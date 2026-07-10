# proxy.py
import asyncio
import json
import os
import websockets
import base64 
from gradium import GradiumClient 
from dotenv import load_dotenv # Import load_dotenv

# Load environment variables from .env.local
load_dotenv(dotenv_path='./.env.local') # Call load_dotenv

async def proxy_websocket(client_websocket, path=None):
    print(f"Client connected to proxy from path: {path}")

    # Load API key from environment
    gradium_api_key = os.environ.get("VITE_GRADIUM_API_KEY")
    if not gradium_api_key:
        print("VITE_GRADIUM_API_KEY not found in environment variables.")
        await client_websocket.close(code=1011, reason="Server configuration error: API key not found.")
        return

    gradium_client = None
    gradium_stt_stream = None

    try:
        gradium_client = GradiumClient(api_key=gradium_api_key)
        gradium_stt_stream = await gradium_client.stt.stream()
        print("Proxy connected to Gradium STT stream.")

        async def receive_from_client():
            async for message in client_websocket:
                if isinstance(message, str): # JSON message (setup, end_of_stream)
                    message_obj = json.loads(message)
                    msg_type = message_obj.get("type")

                    if msg_type == "setup":
                        print(f"Forwarding SETUP message to Gradium: {json.dumps(message_obj)}")
                        await gradium_stt_stream.send_setup(**message_obj)
                    elif msg_type == "end_of_stream":
                        print("Forwarding END_OF_STREAM message to Gradium")
                        await gradium_stt_stream.send_end_of_stream()
                        break 
                    else:
                        print(f"Unknown JSON message type from client: {msg_type}")
                elif isinstance(message, bytes): # Raw audio data
                    # print("Forwarding RAW AUDIO message to Gradium (bytes)") # Too verbose
                    await gradium_stt_stream.send_audio(message)
                else:
                    print(f"Unknown message type from client: {type(message)}")

        async def receive_from_gradium():
            async for gradium_response in gradium_stt_stream:
                print(f"Received from Gradium: {gradium_response}")
                await client_websocket.send(json.dumps(gradium_response.dict()))

        await asyncio.gather(receive_from_client(), receive_from_gradium())

    except websockets.exceptions.ConnectionClosedOK:
        print("Client disconnected gracefully.")
    except websockets.exceptions.ConnectionClosedError as e:
        print(f"Client disconnected with error: {e}")
    except Exception as e:
        print(f"Proxy internal error: {e}")
        if client_websocket.open:
            await client_websocket.close(code=1011, reason=f"Proxy internal error: {e}")
    finally:
        if gradium_stt_stream and gradium_stt_stream.open:
            await gradium_stt_stream.close()
        print("Gradium STT stream closed.")

async def main():
    async with websockets.serve(proxy_websocket, "0.0.0.0", 8001) as server:
        print("WebSocket proxy server started on port 8001")
        await server.wait_closed()

if __name__ == "__main__":
    asyncio.run(main())