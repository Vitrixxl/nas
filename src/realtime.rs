use serde::Serialize;

use crate::models::NodeDto;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RealtimeEvent {
    NodeUpsert {
        node: NodeDto,
        source_client_id: Option<String>,
    },
    NodeDeleted {
        id: String,
        parent_id: Option<String>,
        source_client_id: Option<String>,
    },
}

impl RealtimeEvent {
    pub fn source_client_id(&self) -> Option<&str> {
        match self {
            RealtimeEvent::NodeUpsert {
                source_client_id, ..
            }
            | RealtimeEvent::NodeDeleted {
                source_client_id, ..
            } => source_client_id.as_deref(),
        }
    }
}
