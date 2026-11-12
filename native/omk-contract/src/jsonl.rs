//! Compact JSON objects with an immutable typed view and ordered raw fields.
use serde::de::{DeserializeOwned, MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::value::RawValue;
use std::{collections::HashSet, fmt, marker::PhantomData};

#[derive(Debug)]
pub struct JsonRecord<T> {
    entry: T,
    fields: OrderedFields,
}
impl<T> JsonRecord<T> {
    pub fn entry(&self) -> &T {
        &self.entry
    }
    pub fn into_entry(self) -> T {
        self.entry
    }
}
impl<T: Serialize + DeserializeOwned> JsonRecord<T> {
    /// New typed data is revalidated and serialized in serde's field order.
    pub fn from_entry(entry: T) -> serde_json::Result<Self> {
        serde_json::from_str(&serde_json::to_string(&entry)?)
    }
}
#[derive(Debug)]
struct OrderedFields(Vec<(String, Box<RawValue>)>);
impl Serialize for OrderedFields {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (key, value) in &self.0 {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}
impl<T> Serialize for JsonRecord<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.fields.serialize(serializer)
    }
}
impl<'de, T: DeserializeOwned> Deserialize<'de> for JsonRecord<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct RecordVisitor<T>(PhantomData<T>);
        impl<'de, T: DeserializeOwned> Visitor<'de> for RecordVisitor<T> {
            type Value = JsonRecord<T>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a typed JSON record")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut fields = Vec::new();
                let mut keys = HashSet::new();
                while let Some((key, value)) = map.next_entry::<String, Box<RawValue>>()? {
                    if !keys.insert(key.clone()) {
                        return Err(serde::de::Error::custom("duplicate record field"));
                    }
                    fields.push((key, value));
                }
                let fields = OrderedFields(fields);
                let encoded = serde_json::to_string(&fields).map_err(serde::de::Error::custom)?;
                let entry = serde_json::from_str(&encoded).map_err(serde::de::Error::custom)?;
                Ok(JsonRecord { entry, fields })
            }
        }
        deserializer.deserialize_map(RecordVisitor(PhantomData))
    }
}
