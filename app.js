// DOM Elements
const searchInput = document.getElementById('artist-search');
const suggestionsDiv = document.getElementById('suggestions');
const gallery = document.getElementById('gallery');
const palettePanel = document.getElementById('palette-panel');
const paletteColors = document.getElementById('palette-colors');
const colorCountInput = document.getElementById('color-count');
const backBtn = document.getElementById('back-btn');
const exportBtn = document.getElementById('export-btn');
const hiddenCanvas = document.getElementById('hidden-canvas');
const themeToggle = document.getElementById('theme-toggle');

// State
let currentArtist = null;
let currentImages = [];
let selectedImageUrl = null;
let colorSelectors = [];
let fullResImageData = null;
let fullResCanvas = null;
let currentPaletteColors = []; // Store current palette state
let currentImgWidth = 0;
let currentImgHeight = 0;
let quantizedColors = []; // Store all quantized colors for adding more

// Helper function to strip HTML tags from text
function stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

// Theme toggle
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.documentElement.classList.add('light-mode');
    }
}

function toggleTheme() {
    document.documentElement.classList.toggle('light-mode');
    const isLight = document.documentElement.classList.contains('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

// Initialize theme on load
initTheme();

// Initialize
searchInput.addEventListener('input', handleSearch);
searchInput.addEventListener('focus', handleSearch);
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
        suggestionsDiv.classList.remove('active');
    }
});
colorCountInput.addEventListener('change', () => {
    if (selectedImageUrl && currentPaletteColors.length > 0) {
        adjustColorCount(parseInt(colorCountInput.value));
    }
});
backBtn.addEventListener('click', showGallery);
exportBtn.addEventListener('click', exportPalette);
themeToggle.addEventListener('click', toggleTheme);

// Search handling
function handleSearch() {
    const query = searchInput.value.toLowerCase().trim();
    
    if (query.length === 0) {
        suggestionsDiv.classList.remove('active');
        return;
    }

    const matches = ARTISTS.filter(artist => 
        artist.name.toLowerCase().includes(query)
    );

    if (matches.length > 0) {
        suggestionsDiv.innerHTML = matches.map(artist => `
            <div class="suggestion-item" data-searchterm="${artist.searchTerm}">
                <strong>${artist.name}</strong>
                <small style="color: #888; margin-left: 10px;">${artist.category}</small>
            </div>
        `).join('');
        suggestionsDiv.classList.add('active');

        // Add click handlers
        suggestionsDiv.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => selectArtist(item.dataset.searchterm));
        });
    } else {
        suggestionsDiv.classList.remove('active');
    }
}

// Select artist and fetch their images from Art Institute of Chicago
async function selectArtist(searchTerm) {
    currentArtist = ARTISTS.find(a => a.searchTerm === searchTerm);
    searchInput.value = currentArtist.name;
    suggestionsDiv.classList.remove('active');
    
    gallery.innerHTML = '<div class="loading">Loading artworks</div>';
    palettePanel.classList.add('hidden');

    try {
        const images = await fetchArtInstituteImages(searchTerm);
        currentImages = images;
        displayGallery(images);
    } catch (error) {
        console.error('Error fetching images:', error);
        gallery.innerHTML = '<div class="error-message">Failed to load images. Please try again.</div>';
    }
}

// Fetch images from Art Institute of Chicago API
async function fetchArtInstituteImages(searchTerm) {
    const apiUrl = `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(searchTerm)}&limit=40&fields=id,title,image_id,artist_title,date_display`;
    
    const response = await fetch(apiUrl);
    const data = await response.json();
    
    // Filter for artworks that have images
    const artworksWithImages = data.data.filter(artwork => artwork.image_id);
    
    // Map to our image format
    const images = artworksWithImages.map(artwork => ({
        url: `https://www.artic.edu/iiif/2/${artwork.image_id}/full/843,/0/default.jpg`,
        fullUrl: `https://www.artic.edu/iiif/2/${artwork.image_id}/full/full/0/default.jpg`,
        title: artwork.title || 'Untitled',
        artist: artwork.artist_title || '',
        date: artwork.date_display || ''
    }));

    return images;
}

// Display gallery of images
function displayGallery(images) {
    if (images.length === 0) {
        gallery.innerHTML = '<p class="placeholder-text">No artwork images found for this artist</p>';
        return;
    }

    gallery.classList.remove('single-image');
    gallery.innerHTML = images.map((img, index) => `
        <div class="gallery-item" data-index="${index}">
            <img src="${img.url}" alt="${img.title}" crossorigin="anonymous">
            <div class="title">${img.title}</div>
        </div>
    `).join('');

    // Add click handlers
    gallery.querySelectorAll('.gallery-item').forEach(item => {
        item.addEventListener('click', () => selectImage(parseInt(item.dataset.index)));
    });
}

// Select an image to analyze
function selectImage(index) {
    const image = currentImages[index];
    selectedImageUrl = image.url;
    
    // Show single image view
    gallery.classList.add('single-image');
    gallery.innerHTML = `
        <div class="selected-image-container">
            <div class="image-wrapper" id="image-wrapper">
                <img src="${image.url}" alt="${image.title}" class="selected-image" crossorigin="anonymous" id="selected-img">
                <div class="color-selectors" id="color-selectors"></div>
            </div>
        </div>
    `;
    
    // Show palette panel
    palettePanel.classList.remove('hidden');
    
    // Extract colors
    extractColors(image.url);
}

// Show gallery again
function showGallery() {
    palettePanel.classList.add('hidden');
    selectedImageUrl = null;
    displayGallery(currentImages);
}

// Export palette as JSON array
function exportPalette() {
    if (currentPaletteColors.length === 0) return;
    
    const hexList = currentPaletteColors.map(c => c.hex);
    const jsonString = JSON.stringify(hexList);
    
    // Copy to clipboard
    navigator.clipboard.writeText(jsonString).then(() => {
        showToast('Palette copied to clipboard');
    }).catch(() => {
        // Fallback: show in prompt
        prompt('Copy palette:', jsonString);
    });
}

// Extract colors from image using canvas
async function extractColors(imageUrl) {
    paletteColors.innerHTML = '<div class="loading" style="padding: 20px;">Analyzing</div>';
    clearSelectors();
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
        // Create full resolution canvas for color picking
        fullResCanvas = document.createElement('canvas');
        const fullCtx = fullResCanvas.getContext('2d');
        fullResCanvas.width = img.width;
        fullResCanvas.height = img.height;
        fullCtx.drawImage(img, 0, 0);
        
        try {
            fullResImageData = fullCtx.getImageData(0, 0, img.width, img.height);
        } catch (e) {
            fullResImageData = null;
        }
        
        // Use lower resolution for quantization
        const ctx = hiddenCanvas.getContext('2d');
        const maxSize = 100;
        
        const scale = Math.min(maxSize / img.width, maxSize / img.height);
        const width = Math.floor(img.width * scale);
        const height = Math.floor(img.height * scale);
        
        hiddenCanvas.width = width;
        hiddenCanvas.height = height;
        
        ctx.drawImage(img, 0, 0, width, height);
        
        try {
            const imageData = ctx.getImageData(0, 0, width, height);
            quantizedColors = quantizeColors(imageData.data, 20, width, height); // Get more colors than needed
            const colors = quantizedColors.slice(0, parseInt(colorCountInput.value));
            currentImgWidth = img.width;
            currentImgHeight = img.height;
            currentPaletteColors = colors.map(c => ({
                r: c.r, g: c.g, b: c.b,
                hex: rgbToHex(c.r, c.g, c.b),
                percent: c.percent,
                position: c.positions[0] || { x: 0.5, y: 0.5 }
            }));
            displayPalette(currentPaletteColors);
            createColorSelectors(currentPaletteColors, img.width, img.height);
        } catch (error) {
            console.error('Error extracting colors:', error);
            paletteColors.innerHTML = '<div class="error-message" style="font-size: 0.9rem;">Unable to analyze colors (CORS restriction)</div>';
        }
    };
    
    img.onerror = () => {
        paletteColors.innerHTML = '<div class="error-message" style="font-size: 0.9rem;">Failed to load image</div>';
    };
    
    img.src = imageUrl;
}

// Simple color quantization using median cut algorithm
function quantizeColors(pixels, numColors, width, height) {
    const colorData = new Map();
    
    // Sample pixels and count colors (group similar colors)
    for (let i = 0; i < pixels.length; i += 4) {
        const r = Math.floor(pixels[i] / 16) * 16;
        const g = Math.floor(pixels[i + 1] / 16) * 16;
        const b = Math.floor(pixels[i + 2] / 16) * 16;
        const a = pixels[i + 3];
        
        if (a < 128) continue; // Skip transparent pixels
        
        const key = `${r},${g},${b}`;
        const pixelIndex = i / 4;
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        
        if (!colorData.has(key)) {
            colorData.set(key, { count: 0, positions: [] });
        }
        const data = colorData.get(key);
        data.count++;
        // Store some sample positions (not all to save memory)
        if (data.positions.length < 10) {
            data.positions.push({ x: x / width, y: y / height }); // Normalized 0-1
        }
    }
    
    // Convert to array and sort by frequency
    let colors = Array.from(colorData.entries())
        .map(([key, data]) => {
            const [r, g, b] = key.split(',').map(Number);
            return { r, g, b, count: data.count, positions: data.positions };
        })
        .sort((a, b) => b.count - a.count);
    
    // Remove very similar colors
    const distinctColors = [];
    const totalPixels = pixels.length / 4;
    
    for (const color of colors) {
        const isDuplicate = distinctColors.some(c => 
            Math.abs(c.r - color.r) < 32 &&
            Math.abs(c.g - color.g) < 32 &&
            Math.abs(c.b - color.b) < 32
        );
        
        if (!isDuplicate) {
            distinctColors.push({
                ...color,
                percent: ((color.count / totalPixels) * 100).toFixed(1)
            });
        }
        
        if (distinctColors.length >= numColors) break;
    }
    
    return distinctColors;
}

// Display color palette
function displayPalette(colors) {
    paletteColors.innerHTML = colors.map((color, index) => {
        const hex = color.hex || rgbToHex(color.r, color.g, color.b);
        return `
            <div class="color-swatch" data-hex="${hex}" data-index="${index}" title="Click to copy">
                <div class="swatch-number">${index + 1}</div>
                <div class="swatch-preview" style="background-color: ${hex}"></div>
                <div class="swatch-info">
                    <div class="swatch-hex">${hex}</div>
                    <div class="swatch-percent">${color.percent || ''}%</div>
                </div>
            </div>
        `;
    }).join('');
    
    // Add click to copy
    paletteColors.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            navigator.clipboard.writeText(swatch.dataset.hex);
            showToast(`Copied ${swatch.dataset.hex}`);
        });
    });
}

// Adjust color count - add or remove colors while preserving existing state
function adjustColorCount(newCount) {
    const currentCount = currentPaletteColors.length;
    
    if (newCount === currentCount) return;
    
    if (newCount < currentCount) {
        // Remove colors from the end
        const removedIndices = [];
        for (let i = newCount; i < currentCount; i++) {
            removedIndices.push(i);
        }
        
        // Remove selectors
        removedIndices.forEach(idx => {
            const selectorData = colorSelectors[idx];
            if (selectorData && selectorData.element) {
                selectorData.element.remove();
            }
        });
        
        // Trim arrays
        currentPaletteColors = currentPaletteColors.slice(0, newCount);
        colorSelectors = colorSelectors.slice(0, newCount);
        
    } else {
        // Add more colors
        const selectorsContainer = document.getElementById('color-selectors');
        
        for (let i = currentCount; i < newCount; i++) {
            // Get next quantized color that isn't too similar to existing
            let newColor = null;
            for (const qc of quantizedColors) {
                const isSimilar = currentPaletteColors.some(pc => 
                    Math.abs(pc.r - qc.r) < 32 &&
                    Math.abs(pc.g - qc.g) < 32 &&
                    Math.abs(pc.b - qc.b) < 32
                );
                if (!isSimilar) {
                    newColor = {
                        r: qc.r, g: qc.g, b: qc.b,
                        hex: rgbToHex(qc.r, qc.g, qc.b),
                        percent: qc.percent,
                        position: qc.positions[0] || { x: Math.random(), y: Math.random() }
                    };
                    break;
                }
            }
            
            // Fallback if no distinct color found
            if (!newColor) {
                newColor = {
                    r: 128, g: 128, b: 128,
                    hex: '#808080',
                    percent: '0.0',
                    position: { x: Math.random() * 0.8 + 0.1, y: Math.random() * 0.8 + 0.1 }
                };
            }
            
            currentPaletteColors.push(newColor);
            
            // Create new selector
            if (selectorsContainer) {
                const pos = newColor.position;
                const selector = document.createElement('div');
                selector.className = 'color-selector';
                selector.dataset.index = i;
                selector.innerHTML = `<span class="selector-number">${i + 1}</span>`;
                selector.style.left = `${pos.x * 100}%`;
                selector.style.top = `${pos.y * 100}%`;
                selector.style.borderColor = getContrastColor(newColor.r, newColor.g, newColor.b);
                selector.style.backgroundColor = newColor.hex;
                
                selectorsContainer.appendChild(selector);
                colorSelectors.push({
                    element: selector,
                    index: i,
                    x: pos.x,
                    y: pos.y
                });
                
                makeDraggable(selector, i, currentImgWidth, currentImgHeight);
            }
        }
    }
    
    // Re-render palette display
    displayPalette(currentPaletteColors);
}

// Create draggable color selectors on the image
function createColorSelectors(colors, imgWidth, imgHeight) {
    const selectorsContainer = document.getElementById('color-selectors');
    const imageWrapper = document.getElementById('image-wrapper');
    if (!selectorsContainer || !imageWrapper) return;
    
    colorSelectors = [];
    selectorsContainer.innerHTML = '';
    
    colors.forEach((color, index) => {
        // Use a position where this color was found
        const pos = color.position || color.positions?.[0] || { x: 0.5, y: 0.5 };
        const hex = color.hex || rgbToHex(color.r, color.g, color.b);
        
        const selector = document.createElement('div');
        selector.className = 'color-selector';
        selector.dataset.index = index;
        selector.innerHTML = `<span class="selector-number">${index + 1}</span>`;
        selector.style.left = `${pos.x * 100}%`;
        selector.style.top = `${pos.y * 100}%`;
        selector.style.borderColor = getContrastColor(color.r, color.g, color.b);
        selector.style.backgroundColor = hex;
        
        selectorsContainer.appendChild(selector);
        colorSelectors.push({
            element: selector,
            index: index,
            x: pos.x,
            y: pos.y
        });
        
        // Make selector draggable
        makeDraggable(selector, index, imgWidth, imgHeight);
    });
}

// Clear all selectors
function clearSelectors() {
    colorSelectors = [];
    const selectorsContainer = document.getElementById('color-selectors');
    if (selectorsContainer) {
        selectorsContainer.innerHTML = '';
    }
}

// Make a selector draggable
function makeDraggable(selector, index, imgWidth, imgHeight) {
    let isDragging = false;
    let startX, startY;
    
    const onStart = (e) => {
        e.preventDefault();
        isDragging = true;
        selector.classList.add('dragging');
        
        const touch = e.touches ? e.touches[0] : e;
        startX = touch.clientX;
        startY = touch.clientY;
        
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchmove', onMove);
        document.addEventListener('touchend', onEnd);
    };
    
    const onMove = (e) => {
        if (!isDragging) return;
        
        const touch = e.touches ? e.touches[0] : e;
        const imageWrapper = document.getElementById('image-wrapper');
        const rect = imageWrapper.getBoundingClientRect();
        
        // Calculate position relative to image
        let x = (touch.clientX - rect.left) / rect.width;
        let y = (touch.clientY - rect.top) / rect.height;
        
        // Clamp to image bounds
        x = Math.max(0, Math.min(1, x));
        y = Math.max(0, Math.min(1, y));
        
        // Update selector position
        selector.style.left = `${x * 100}%`;
        selector.style.top = `${y * 100}%`;
        
        // Update color based on new position
        updateSelectorColor(index, x, y, imgWidth, imgHeight);
    };
    
    const onEnd = () => {
        isDragging = false;
        selector.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
    };
    
    selector.addEventListener('mousedown', onStart);
    selector.addEventListener('touchstart', onStart);
}

// Update selector color when moved
function updateSelectorColor(index, x, y, imgWidth, imgHeight) {
    if (!fullResImageData) return;
    
    // Get pixel color at new position
    const pixelX = Math.floor(x * imgWidth);
    const pixelY = Math.floor(y * imgHeight);
    const pixelIndex = (pixelY * imgWidth + pixelX) * 4;
    
    const r = fullResImageData.data[pixelIndex];
    const g = fullResImageData.data[pixelIndex + 1];
    const b = fullResImageData.data[pixelIndex + 2];
    const hex = rgbToHex(r, g, b);
    
    // Update the stored palette color state
    if (currentPaletteColors[index]) {
        currentPaletteColors[index].r = r;
        currentPaletteColors[index].g = g;
        currentPaletteColors[index].b = b;
        currentPaletteColors[index].hex = hex;
        currentPaletteColors[index].position = { x, y };
    }
    
    // Update selector position in state
    if (colorSelectors[index]) {
        colorSelectors[index].x = x;
        colorSelectors[index].y = y;
    }
    
    // Update selector appearance
    const selector = colorSelectors[index]?.element;
    if (selector) {
        selector.style.backgroundColor = hex;
        selector.style.borderColor = getContrastColor(r, g, b);
    }
    
    // Update palette swatch
    const swatch = paletteColors.querySelector(`[data-index="${index}"]`);
    if (swatch) {
        swatch.dataset.hex = hex;
        const preview = swatch.querySelector('.swatch-preview');
        const hexDisplay = swatch.querySelector('.swatch-hex');
        if (preview) preview.style.backgroundColor = hex;
        if (hexDisplay) hexDisplay.textContent = hex;
    }
}

// Get contrasting color (black or white) for visibility
function getContrastColor(r, g, b) {
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

// Convert RGB to Hex
function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('').toUpperCase();
}

// Show toast notification
function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    
    toast.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}
