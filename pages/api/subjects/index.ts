import type { NextApiRequest, NextApiResponse } from 'next';
import jwt from 'jsonwebtoken';
import { connectDB } from '@/lib/mongodb';
import Subject from '@/models/Subject';
import pdfParse from 'pdf-parse';
import formidable from 'formidable';
import fs from 'fs';

// Type for JWT payload
interface JWTPayload {
  userId: string;
}

// Type for formidable file object
interface FormidableFile {
  originalFilename?: string;
  newFilename?: string;
  mimetype?: string;
  filepath?: string;
  path?: string;
}

// Helper function to safely extract string from formidable fields
function getFieldValue(field: string[] | string | undefined): string {
  if (Array.isArray(field)) {
    return field[0] || '';
  }
  return field || '';
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ message: 'No token provided' });
      }
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as JWTPayload;
      await connectDB();
      const subjects = await Subject.find({ userId: decoded.userId }).sort({ createdAt: -1 });
      return res.status(200).json(subjects);
    } catch (error) {
      console.error('Get subjects error:', error);
      return res.status(500).json({ message: 'Internal server error', error: String(error) });
    }
  } else if (req.method === 'POST') {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ message: 'No token provided' });
      }
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as JWTPayload;
      await connectDB();
      if (req.headers['content-type']?.startsWith('multipart/form-data')) {
        const form = new formidable.IncomingForm();
        form.parse(req, async (err, fields, files) => {
          if (err) {
            return res.status(500).json({ message: 'Error parsing form', error: String(err) });
          }
          
          // Handle formidable field types properly
          const name = getFieldValue(fields.name);
          const description = getFieldValue(fields.description);
          const difficulty = getFieldValue(fields.difficulty);
          
          const file = files.file;
          let topics = [];
          let filesArr = [];
          
          if (file) {
            let text = '';
            // Handle formidable file type properly
            const fileObj = Array.isArray(file) ? file[0] : file;
            
            // Type guard for formidable file object
            if (fileObj && typeof fileObj === 'object' && 'originalFilename' in fileObj) {
              const formidableFile = fileObj as FormidableFile;
              let fileName = formidableFile.originalFilename || formidableFile.newFilename || 'uploaded';
              let fileType = formidableFile.mimetype || 'application/octet-stream';
              const filePath = formidableFile.filepath || formidableFile.path;
              
              if (!filePath) {
                return res.status(500).json({ message: 'File path not found' });
              }
              
              try {
                const buffer = fs.readFileSync(filePath);
                if (fileType === 'application/pdf') {
                  const data = await pdfParse(buffer);
                  text = data.text;
                } else if (fileType === 'text/plain') {
                  text = buffer.toString('utf-8');
                }
              } catch (parseErr) {
                return res.status(500).json({ message: 'Failed to parse file', error: String(parseErr) });
              }
              
              if (text) {
                topics.push({
                  title: fileName,
                  content: text,
                  difficulty: difficulty || 'Medium',
                });
              }
              
              filesArr.push({
                name: fileName,
                type: fileType,
                uploadedAt: new Date(),
              });
            }
          }
          
          const subject = await Subject.create({
            name,
            description,
            difficulty: difficulty || 'Medium',
            userId: decoded.userId,
            topics,
            files: filesArr,
          });
          
          return res.status(200).json(subject);
        });
      } else {
        // JSON body fallback
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          const { name, description, difficulty } = JSON.parse(body);
          if (!name) {
            return res.status(400).json({ message: 'Subject name is required' });
          }
          const subject = await Subject.create({
            name,
            description,
            difficulty: difficulty || 'Medium',
            userId: decoded.userId,
          });
          return res.status(200).json(subject);
        });
      }
    } catch (error) {
      console.error('Create subject error:', error);
      return res.status(500).json({ message: 'Internal server error', error: String(error) });
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }
} 