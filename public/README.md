# Public Assets Directory

This folder contains static assets served directly from the root URL.

## Folder Structure

```
public/
├── images/          # General images (photos, backgrounds, etc.)
├── icons/           # Icons and small graphics
├── logos/           # Company logos and branding
└── uploads/         # User-uploaded content (if storing locally)
```

## Usage in Components

```tsx
// Using Next.js Image component (recommended)
import Image from 'next/image';

<Image src="/images/logo.png" alt="Logo" width={100} height={100} />

// Regular img tag
<img src="/icons/user.svg" alt="User icon" />
```

## Best Practices

1. **Use Next.js Image component** for automatic optimization
2. **Optimize images** before uploading (compress, resize)
3. **Use descriptive filenames**: `asi-logo-dark.png` not `img1.png`
4. **Organize by type**: Keep images, icons, logos separate
5. **For user uploads**: Use Firebase Storage, not this folder
