use arboard::{Clipboard, Error as ClipboardError};
use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImage {
    data_url: String,
    width: usize,
    height: usize,
}

#[tauri::command]
pub fn clipboard_read_image() -> Result<Option<ClipboardImage>, String> {
    let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;
    let image = match clipboard.get_image() {
        Ok(image) => image,
        Err(ClipboardError::ContentNotAvailable) => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };

    let width = image.width;
    let height = image.height;
    let data_url = encode_rgba_png_data_url(width, height, &image.bytes)?;
    Ok(Some(ClipboardImage {
        data_url,
        width,
        height,
    }))
}

fn encode_rgba_png_data_url(width: usize, height: usize, rgba: &[u8]) -> Result<String, String> {
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
        writer
            .write_image_data(rgba)
            .map_err(|error| error.to_string())?;
    }
    Ok(format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(png_bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::encode_rgba_png_data_url;

    #[test]
    fn encodes_rgba_as_png_data_url() {
        let data_url = encode_rgba_png_data_url(1, 1, &[255, 0, 0, 255]).unwrap();

        assert!(data_url.starts_with("data:image/png;base64,"));
    }
}
