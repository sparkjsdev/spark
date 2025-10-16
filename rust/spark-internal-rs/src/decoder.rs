use std::cell::RefCell;

use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;
use spark_lib::decoder::ChunkReceiver;

const MAX_BUFFER_SIZE: usize = 1048576;

thread_local! {
    static BUFFER: RefCell<Vec<u8>> = RefCell::new(Vec::new());
}

#[wasm_bindgen]
pub struct ChunkDecoder {
    receiver: Box<dyn ChunkReceiver>,
    on_finish: Box<dyn FnOnce(Box<dyn ChunkReceiver>) -> Result<JsValue, JsValue>>,
}

impl ChunkDecoder {
    pub fn new(
        receiver: Box<dyn ChunkReceiver>,
        on_finish: Box<dyn FnOnce(Box<dyn ChunkReceiver>) -> Result<JsValue, JsValue>>,
    ) -> Self {
        Self { receiver, on_finish }
    }

    pub fn into_inner(self) -> (Box<dyn ChunkReceiver>, Box<dyn FnOnce(Box<dyn ChunkReceiver>) -> Result<JsValue, JsValue>>) {
        (self.receiver, self.on_finish)
    }
}

#[wasm_bindgen]
impl ChunkDecoder {
    #[wasm_bindgen]
    pub fn push(&mut self, bytes: Uint8Array) -> Result<(), JsValue> {
        BUFFER.with_borrow_mut(|buffer| {
            buffer.resize((bytes.length() as usize).min(MAX_BUFFER_SIZE), 0);

            let mut base = 0;
            while base < bytes.length() {                
                let chunk = (bytes.length() - base).min(buffer.len() as u32);
                bytes.subarray(base, base + chunk).copy_to(&mut buffer[..chunk as usize]);
                self.receiver.push(&buffer[..chunk as usize]).map_err(|e| JsValue::from_str(&e.to_string()))?;
                base += chunk;
            }
            Ok::<(), JsValue>(())
        })?;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn finish(mut self) -> Result<JsValue, JsValue> {
        self.receiver.finish().map_err(|e| JsValue::from_str(&e.to_string()))?;
        let (receiver, on_finish) = self.into_inner();
        on_finish(receiver)
    }

}
