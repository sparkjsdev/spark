use js_sys::Uint32Array;
use serde::{Serialize, Serializer};
use tsify::Tsify;
use spark_lib::decoder::SplatFileType;

#[derive(Tsify, Serialize)]
#[serde(transparent)]
#[tsify(type = "Uint32Array<ArrayBuffer>")]
pub struct PreservedUint32Array(
    #[serde(with = "serde_wasm_bindgen::preserve")]
    pub Uint32Array,
);

impl From<Uint32Array> for PreservedUint32Array {
    fn from(arr: Uint32Array) -> Self {
        Self(arr)
    }
}

pub fn serialize_splat_file_type<S>(val: &Option<SplatFileType>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match val {
        Some(v) => serializer.serialize_str(v.to_enum_str()),
        None => serializer.serialize_none(),
    }
}